import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, RefreshCw, StopCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	type DebugIngestStatus,
	getDebugIngestOverview,
	stopDebugIngestServer,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

const NGROK_AGENT_DASHBOARD_URL = "https://dashboard.ngrok.com/agents";

export function DebugIngestNgrokPanel() {
	const { settings, updateSettings } = useSettings();
	const queryClient = useQueryClient();
	const [stoppingWorkspaceId, setStoppingWorkspaceId] = useState<string | null>(
		null,
	);
	const overviewQuery = useQuery({
		queryKey: helmorQueryKeys.debugIngestOverview,
		queryFn: getDebugIngestOverview,
		refetchInterval: settings.debugIngestPublicForward ? 5000 : false,
	});

	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: helmorQueryKeys.debugIngestOverview,
		});
	}, [queryClient]);

	const stopInstance = useCallback(
		async (workspaceId: string) => {
			setStoppingWorkspaceId(workspaceId);
			try {
				await stopDebugIngestServer(workspaceId);
				await refresh();
			} finally {
				setStoppingWorkspaceId(null);
			}
		},
		[refresh],
	);

	const overview = overviewQuery.data;
	const instances = overview?.instances ?? [];
	const activeTunnelCount = overview?.ngrokAgent.activeTunnelCount ?? 0;
	const agentConnected = overview?.ngrokAgent.connected === true;
	const sessionId = overview?.ngrokAgent.sessionId;

	return (
		<>
			<SettingsRow
				title="Expose Debug ingest with ngrok"
				description="When Debug mode is active, open public HTTPS endpoints for preview deployments. This is opt-in and stays off by default."
			>
				<Switch
					checked={settings.debugIngestPublicForward}
					onCheckedChange={(checked) =>
						updateSettings({ debugIngestPublicForward: checked })
					}
				/>
			</SettingsRow>
			<div className="border-border/40 border-b py-5">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium leading-snug text-foreground">
							Debug ingest ngrok
						</div>
						<div className="mt-1 text-[12px] leading-snug text-muted-foreground">
							Helmor reuses one ngrok agent session for all Debug ingest
							endpoints so multiple workspaces do not consume multiple ngrok
							agent-session slots. Set NGROK_AUTHTOKEN in Helmor's environment
							to authorize ngrok without storing credentials in app settings.
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Badge variant={agentConnected ? "default" : "outline"}>
							{settings.debugIngestPublicForward
								? agentConnected
									? "Agent connected"
									: "Agent idle"
								: "Disabled"}
						</Badge>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void refresh()}
							disabled={overviewQuery.isFetching}
						>
							{overviewQuery.isFetching ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<RefreshCw className="size-3.5" />
							)}
						</Button>
					</div>
				</div>
				<div className="mt-4 grid gap-4">
					<Field>
						<FieldLabel>Reserved domain (optional)</FieldLabel>
						<FieldContent>
							<Input
								type="text"
								value={settings.debugIngestNgrokDomain}
								onChange={(event) =>
									updateSettings({
										debugIngestNgrokDomain: event.target.value,
									})
								}
								placeholder="debug.example.ngrok.app"
								className="bg-muted/30 text-[13px] text-foreground placeholder:text-muted-foreground/50"
							/>
						</FieldContent>
					</Field>
					{settings.debugIngestPublicForward ? null : (
						<SettingsNotice>
							Public forwarding is disabled. Existing local Debug ingest servers
							are listed here for cleanup, but Helmor will not open ngrok
							tunnels until you enable the setting.
						</SettingsNotice>
					)}
					<NgrokInstanceList
						activeTunnelCount={activeTunnelCount}
						instances={instances}
						lastError={overview?.ngrokAgent.lastError ?? null}
						loading={overviewQuery.isPending}
						sessionId={sessionId ?? null}
						stoppingWorkspaceId={stoppingWorkspaceId}
						onStop={stopInstance}
					/>
				</div>
			</div>
		</>
	);
}

function NgrokInstanceList({
	activeTunnelCount,
	instances,
	lastError,
	loading,
	sessionId,
	stoppingWorkspaceId,
	onStop,
}: {
	activeTunnelCount: number;
	instances: DebugIngestStatus[];
	lastError: string | null;
	loading: boolean;
	sessionId: string | null;
	stoppingWorkspaceId: string | null;
	onStop: (workspaceId: string) => Promise<void>;
}) {
	return (
		<div className="rounded-lg border border-border/50 bg-muted/15 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 text-[12px] leading-snug text-muted-foreground">
					<div className="font-medium text-foreground">Managed instances</div>
					<div className="mt-1">
						{sessionId
							? `Session ${sessionId}`
							: "No ngrok agent session is active."}
					</div>
					<div>{activeTunnelCount} public endpoint(s) active.</div>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void openUrl(NGROK_AGENT_DASHBOARD_URL)}
				>
					<ExternalLink className="mr-1.5 size-3.5" />
					Dashboard
				</Button>
			</div>
			{lastError ? (
				<SettingsNotice tone="error">{lastError}</SettingsNotice>
			) : null}
			{loading ? (
				<div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					Checking Debug ingest instances…
				</div>
			) : instances.length === 0 ? (
				<div className="mt-3 text-[12px] text-muted-foreground">
					No Debug ingest servers are running. Turn on Debug mode in a workspace
					composer to start one.
				</div>
			) : (
				<div className="mt-3 grid gap-2">
					{instances.map((instance) => (
						<div
							key={instance.workspaceId}
							className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2"
						>
							<div className="min-w-0 text-[12px] leading-snug">
								<div className="font-mono text-foreground">
									{instance.workspaceId}
								</div>
								<div className="mt-1 text-muted-foreground">
									Local: {instance.url ?? "—"}
								</div>
								<div className="break-all text-muted-foreground">
									Public: {instance.publicUrl ?? "not exposed"}
								</div>
								{instance.tunnelError ? (
									<div className="mt-1 text-destructive">
										{instance.tunnelError}
									</div>
								) : null}
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void onStop(instance.workspaceId)}
								disabled={stoppingWorkspaceId === instance.workspaceId}
							>
								{stoppingWorkspaceId === instance.workspaceId ? (
									<Loader2 className="mr-1.5 size-3.5 animate-spin" />
								) : (
									<StopCircle className="mr-1.5 size-3.5" />
								)}
								Stop
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
