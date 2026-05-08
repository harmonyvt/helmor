import { openUrl } from "@tauri-apps/plugin-opener";
import {
	ExternalLink,
	Loader2,
	Network,
	Power,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	cleanupWebDaemon,
	getWebDaemonStatus,
	startWebDaemon,
	stopWebDaemon,
	type WebDaemonStatus,
} from "@/lib/api";
import {
	SettingsGroup,
	SettingsNotice,
	SettingsRow,
} from "../components/settings-row";

export function WebDaemonPanel() {
	const [status, setStatus] = useState<WebDaemonStatus | null>(null);
	const [listenHost, setListenHost] = useState("127.0.0.1");
	const [loading, setLoading] = useState(true);
	const listenHostInitialized = useRef(false);
	const actionRef = useRef<"start" | "stop" | "cleanup" | null>(null);
	const [action, setAction] = useState<"start" | "stop" | "cleanup" | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (actionRef.current !== null) {
			return;
		}
		setError(null);
		try {
			const nextStatus = await getWebDaemonStatus();
			setStatus(nextStatus);
			if (!nextStatus.startedAtMs && !listenHostInitialized.current) {
				setListenHost(nextStatus.listenHost || nextStatus.host || "127.0.0.1");
				listenHostInitialized.current = true;
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const interval = window.setInterval(() => void refresh(), 5000);
		return () => window.clearInterval(interval);
	}, [refresh]);

	const runAction = useCallback(
		async (nextAction: "start" | "stop" | "cleanup") => {
			actionRef.current = nextAction;
			setAction(nextAction);
			setError(null);
			try {
				const nextStatus =
					nextAction === "start"
						? await startWebDaemon({ host: listenHost })
						: nextAction === "stop"
							? await stopWebDaemon()
							: await cleanupWebDaemon();
				setStatus(nextStatus);
				if (nextAction === "start") {
					toast.success("Web daemon started", {
						description: nextStatus.openUrl || nextStatus.url,
					});
				} else if (nextAction === "stop") {
					toast.success("Web daemon stopped");
				} else {
					toast.success("Web daemon cleaned up");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				actionRef.current = null;
				setAction(null);
			}
		},
		[listenHost],
	);

	const running = status?.state === "running";
	const busy = action !== null;
	const networkMode = listenHost === "0.0.0.0";
	const openWebUrl = status?.openUrl || status?.url || "";
	const reachableUrls = status?.reachableUrls?.length
		? status.reachableUrls
		: status?.url
			? [status.url]
			: [];

	return (
		<SettingsGroup>
			<SettingsRow
				align="start"
				title={
					<span className="flex items-center gap-2">
						<span>Web Companion Daemon</span>
						<Badge variant={running ? "default" : "outline"}>
							{loading ? "Checking" : running ? "Running" : "Stopped"}
						</Badge>
					</span>
				}
				description={
					<>
						Run a web server for browser access. Localhost is private to this
						Mac; Network/Tailnet listens on all interfaces for Tailscale peers.
						{!running ? (
							<div className="mt-3 flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant={networkMode ? "outline" : "secondary"}
									size="sm"
									onClick={() => {
										listenHostInitialized.current = true;
										setListenHost("127.0.0.1");
									}}
									disabled={busy || loading}
								>
									Localhost
								</Button>
								<Button
									type="button"
									variant={networkMode ? "secondary" : "outline"}
									size="sm"
									onClick={() => {
										listenHostInitialized.current = true;
										setListenHost("0.0.0.0");
									}}
									disabled={busy || loading}
								>
									<Network className="mr-1.5 size-3.5" />
									Network/Tailnet
								</Button>
							</div>
						) : null}
						{networkMode || status?.listenHost === "0.0.0.0" ? (
							<SettingsNotice tone="warn">
								Network/Tailnet mode exposes the unauthenticated web API to
								trusted LAN and Tailscale peers that can reach this port.
							</SettingsNotice>
						) : null}
						{status ? (
							<div className="mt-2 grid gap-1.5 font-mono text-[11px] text-muted-foreground/90">
								<div>Open: {openWebUrl}</div>
								<div>
									Listen: {status.listenHost}:{status.port}
								</div>
								{reachableUrls.length > 1 ? (
									<div>Reachable: {reachableUrls.join(", ")}</div>
								) : null}
								<div>PID: {status.pid ?? "—"}</div>
								<div>Identity: {status.identity}</div>
								<div>Data: {status.dataDir}</div>
								<div>Frontend: {status.frontendDir}</div>
							</div>
						) : null}
						{status && !status.frontendExists ? (
							<SettingsNotice tone="warn">
								Browser bundle not found. Run <code>bun run build:web</code>{" "}
								before starting the daemon from settings.
							</SettingsNotice>
						) : null}
						{status?.lastError ? (
							<SettingsNotice tone="error">{status.lastError}</SettingsNotice>
						) : null}
						{error ? (
							<SettingsNotice tone="error">{error}</SettingsNotice>
						) : null}
					</>
				}
			>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => void refresh()}
						disabled={busy || loading}
					>
						<RefreshCw className="size-3.5" />
					</Button>
					{running ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => void openUrl(openWebUrl)}
						>
							<ExternalLink className="mr-1.5 size-3.5" />
							Open
						</Button>
					) : null}
					<Button
						variant={running ? "outline" : "default"}
						size="sm"
						onClick={() => void runAction(running ? "stop" : "start")}
						disabled={
							busy || loading || (!running && status?.frontendExists === false)
						}
					>
						{action === "start" || action === "stop" ? (
							<Loader2 className="mr-1.5 size-3.5 animate-spin" />
						) : (
							<Power className="mr-1.5 size-3.5" />
						)}
						{running ? "Stop" : "Start"}
					</Button>
				</div>
			</SettingsRow>

			<SettingsRow
				align="start"
				title="Cleanup Current Daemon"
				description="Stops the daemon recorded for the active data mode and clears stale runtime state. This does not touch other dev, preview, or production data directories."
			>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => void runAction("cleanup")}
					disabled={busy || loading}
				>
					{action === "cleanup" ? (
						<Loader2 className="mr-1.5 size-3.5 animate-spin" />
					) : (
						<Trash2 className="mr-1.5 size-3.5" />
					)}
					Cleanup
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
