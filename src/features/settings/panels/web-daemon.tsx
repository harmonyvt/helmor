import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, Power, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	deleteWebDaemon,
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
	const [loading, setLoading] = useState(true);
	const [action, setAction] = useState<"start" | "stop" | "delete" | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setError(null);
		try {
			setStatus(await getWebDaemonStatus());
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
		async (nextAction: "start" | "stop" | "delete") => {
			setAction(nextAction);
			setError(null);
			try {
				const nextStatus =
					nextAction === "start"
						? await startWebDaemon()
						: nextAction === "stop"
							? await stopWebDaemon()
							: await deleteWebDaemon();
				setStatus(nextStatus);
				if (nextAction === "start") {
					toast.success("Web daemon started", {
						description: nextStatus.url,
					});
				} else if (nextAction === "stop") {
					toast.success("Web daemon stopped");
				} else {
					toast.success("Web daemon deleted");
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setAction(null);
			}
		},
		[],
	);

	const running = status?.state === "running";
	const busy = action !== null;

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
						Run a local web server for browser access. It binds to localhost by
						default, so expose it through Tailscale Serve or a trusted tunnel
						when you need remote access.
						{status ? (
							<div className="mt-2 grid gap-1.5 font-mono text-[11px] text-muted-foreground/90">
								<div>URL: {status.url}</div>
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
							onClick={() => void openUrl(status?.url ?? "")}
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
				title="Delete Daemon Instance"
				description="Stops the managed daemon process and clears its in-app lifecycle state. This does not delete your workspaces, sessions, repositories, or browser bundle."
			>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => void runAction("delete")}
					disabled={busy || loading}
				>
					{action === "delete" ? (
						<Loader2 className="mr-1.5 size-3.5 animate-spin" />
					) : (
						<Trash2 className="mr-1.5 size-3.5" />
					)}
					Delete
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
