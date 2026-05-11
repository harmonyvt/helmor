/**
 * Realtime panel — sidecar state (state 7).
 *
 * Shows the sidecar invocation card: pid, cwd, active model, capability
 * flags, and a live streaming indicator. Useful for debugging and
 * confirming which model + session is running.
 */
import { PanelHeader, PanelShell } from "./shell";

interface SidecarInfo {
	pid?: number;
	cwd?: string;
	model?: string;
	capabilities?: string[];
	streaming?: boolean;
}

interface RealtimePanelSidecarProps {
	info?: SidecarInfo;
	onClose?: () => void;
}

export function RealtimePanelSidecar({
	info = DEMO_INFO,
	onClose,
}: RealtimePanelSidecarProps) {
	return (
		<PanelShell height={300}>
			<PanelHeader status="Sidecar" onClose={onClose} />

			<div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
				<div
					style={{
						borderRadius: 9,
						border: "1px solid var(--border)",
						background: "var(--card)",
						overflow: "hidden",
					}}
				>
					{/* Header row */}
					<div
						style={{
							padding: "8px 12px",
							borderBottom: "1px solid var(--border)",
							display: "flex",
							alignItems: "center",
							gap: 8,
						}}
					>
						<span
							style={{
								fontSize: 12,
								fontWeight: 600,
								color: "var(--foreground)",
							}}
						>
							helmor-sidecar
						</span>
						{info.pid && (
							<span
								style={{
									fontSize: 10,
									fontFamily: "var(--font-mono)",
									color: "var(--muted-foreground)",
								}}
							>
								pid {info.pid}
							</span>
						)}
						{info.streaming && (
							<span
								className="pi-dot-pulse"
								style={{
									marginLeft: "auto",
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontSize: 10,
									color: "var(--rt-accent)",
								}}
							>
								<span
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: "var(--rt-accent)",
										display: "inline-block",
									}}
								/>
								streaming
							</span>
						)}
					</div>

					{/* Details */}
					<div
						style={{
							padding: "8px 12px",
							display: "flex",
							flexDirection: "column",
							gap: 5,
						}}
					>
						{info.model && <Row label="model" value={info.model} />}
						{info.cwd && <Row label="cwd" value={info.cwd} truncate />}
					</div>

					{/* Capabilities */}
					{info.capabilities && info.capabilities.length > 0 && (
						<div
							style={{
								padding: "8px 12px",
								borderTop: "1px solid var(--border)",
								display: "flex",
								flexWrap: "wrap",
								gap: 4,
							}}
						>
							{info.capabilities.map((cap) => (
								<span
									key={cap}
									style={{
										fontSize: 10,
										fontFamily: "var(--font-mono)",
										background:
											"color-mix(in oklch, var(--muted) 80%, transparent)",
										color: "var(--muted-foreground)",
										borderRadius: 4,
										padding: "2px 6px",
									}}
								>
									{cap}
								</span>
							))}
						</div>
					)}
				</div>
			</div>
		</PanelShell>
	);
}

function Row({
	label,
	value,
	truncate,
}: {
	label: string;
	value: string;
	truncate?: boolean;
}) {
	return (
		<div style={{ display: "flex", gap: 10, fontSize: 11 }}>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					color: "var(--muted-foreground)",
					minWidth: 52,
					flexShrink: 0,
				}}
			>
				{label}
			</span>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					color: "var(--foreground)",
					flex: 1,
					overflow: "hidden",
					textOverflow: truncate ? "ellipsis" : undefined,
					whiteSpace: truncate ? "nowrap" : undefined,
				}}
			>
				{value}
			</span>
		</div>
	);
}

const DEMO_INFO: SidecarInfo = {
	pid: 84231,
	cwd: "~/helmor/workspaces/helmor/mintaka-1",
	model: "azure/gpt-realtime-2",
	capabilities: ["text", "tool_calls", "context_window"],
	streaming: true,
};
