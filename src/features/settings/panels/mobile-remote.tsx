import { Copy, Loader2, RefreshCcw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	getRemoteAccessConfig,
	type RemoteAccessStatus,
	rotateRemoteAccessToken,
	updateRemoteAccessConfig,
} from "@/lib/api";
import {
	SettingsGroup,
	SettingsNotice,
	SettingsRow,
} from "../components/settings-row";

export function MobileRemotePanel() {
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [bindAddr, setBindAddr] = useState("127.0.0.1");
	const [port, setPort] = useState("4317");
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const mobileUrl = useMemo(() => status?.url ?? "", [status]);

	useEffect(() => {
		void getRemoteAccessConfig().then((next) => {
			setStatus(next);
			setBindAddr(next.bindAddr);
			setPort(String(next.port));
		});
	}, []);

	const applyStatus = useCallback((next: RemoteAccessStatus) => {
		setStatus(next);
		setBindAddr(next.bindAddr);
		setPort(String(next.port));
	}, []);

	const save = useCallback(
		async (enabled: boolean) => {
			setSaving(true);
			setError(null);
			setNotice(null);
			try {
				const next = await updateRemoteAccessConfig({
					enabled,
					bindAddr,
					port: Number.parseInt(port, 10) || 4317,
				});
				applyStatus(next);
				setNotice(
					enabled ? "Mobile access is running." : "Mobile access is off.",
				);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setSaving(false);
			}
		},
		[applyStatus, bindAddr, port],
	);

	const copyPairing = useCallback(async () => {
		if (!status) return;
		const value = `${status.url}\nToken: ${status.token}`;
		await navigator.clipboard?.writeText(value);
		setNotice("Copied URL and token.");
	}, [status]);

	const rotateToken = useCallback(async () => {
		setSaving(true);
		setError(null);
		setNotice(null);
		try {
			const next = await rotateRemoteAccessToken();
			applyStatus(next);
			setNotice("Pairing token rotated.");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	}, [applyStatus]);

	return (
		<SettingsGroup>
			<SettingsRow
				align="start"
				title={
					<span className="flex items-center gap-1.5">
						<Smartphone className="size-3.5 text-muted-foreground" />
						<span>Mobile Web Companion</span>
					</span>
				}
				description={
					<>
						Serve a phone-sized Helmor UI over your private network. Use your
						Mac&apos;s Tailscale IP with the port below.
						{status?.enabled ? (
							<SettingsNotice tone={status.running ? "ok" : "warn"}>
								{status.running ? "Running at " : "Enabled but not running at "}
								<code className="rounded bg-muted px-1 py-0.5">
									{mobileUrl}
								</code>
							</SettingsNotice>
						) : (
							<SettingsNotice tone="info">Disabled by default.</SettingsNotice>
						)}
						{notice ? (
							<SettingsNotice tone="ok">{notice}</SettingsNotice>
						) : null}
						{error ? (
							<SettingsNotice tone="error">{error}</SettingsNotice>
						) : null}
					</>
				}
			>
				<Switch
					checked={status?.enabled ?? false}
					disabled={saving || !status}
					onCheckedChange={(checked) => void save(checked)}
				/>
			</SettingsRow>

			<SettingsRow
				align="start"
				title="Bind address"
				description="Use 127.0.0.1 for local testing, 0.0.0.0 for LAN/Tailscale access, or a specific Tailscale IP."
			>
				<div className="flex items-center gap-2">
					<Input
						className="h-8 w-[150px]"
						value={bindAddr}
						onChange={(event) => setBindAddr(event.target.value)}
					/>
					<Input
						className="h-8 w-[78px]"
						inputMode="numeric"
						value={port}
						onChange={(event) => setPort(event.target.value)}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={saving}
						onClick={() => void save(status?.enabled ?? false)}
					>
						{saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
					</Button>
				</div>
			</SettingsRow>

			<SettingsRow
				align="start"
				title="Pairing token"
				description="Required for every mobile API request. Rotate it if a device should lose access."
			>
				<div className="flex items-center gap-2">
					<code className="max-w-[180px] truncate rounded bg-muted px-2 py-1 text-[11px]">
						{status?.token ?? "Loading..."}
					</code>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={!status}
						onClick={() => void copyPairing()}
					>
						<Copy className="size-3.5" />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={saving || !status}
						onClick={() => void rotateToken()}
					>
						<RefreshCcw className="size-3.5" />
					</Button>
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}
