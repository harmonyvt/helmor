/**
 * Realtime panel — workspace-pick state (state 5).
 *
 * Shown when the agent needs the user to pick a workspace.
 * Three ranked matches are displayed; pressing 1-3 selects.
 */
import { Kbd } from "../primitives";
import type { WorkspaceMatch } from "../types";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelWorkspacePickProps {
	matches?: WorkspaceMatch[];
	onPick?: (id: string) => void;
	onCancel?: () => void;
	onClose?: () => void;
}

export function RealtimePanelWorkspacePick({
	matches = DEMO_MATCHES,
	onPick,
	onCancel,
	onClose,
}: RealtimePanelWorkspacePickProps) {
	return (
		<PanelShell height={320}>
			<PanelHeader status="Pick workspace" onClose={onClose} />

			<div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
				{matches.map((m) => (
					<button
						key={m.id}
						type="button"
						onClick={() => onPick?.(m.id)}
						style={{
							width: "100%",
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "8px 14px",
							background: "transparent",
							border: "none",
							cursor: "pointer",
							textAlign: "left",
						}}
						onMouseEnter={(e) => {
							(e.currentTarget as HTMLElement).style.background =
								"var(--accent)";
						}}
						onMouseLeave={(e) => {
							(e.currentTarget as HTMLElement).style.background = "transparent";
						}}
					>
						<Kbd>{m.rank}</Kbd>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									fontSize: 13,
									fontWeight: 500,
									color: "var(--foreground)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{m.name}
							</div>
							<div
								style={{
									fontSize: 11,
									color: "var(--muted-foreground)",
									fontFamily: "var(--font-mono)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{m.branch}
							</div>
						</div>
					</button>
				))}
			</div>

			<PanelFooter>
				<span
					style={{ fontSize: 11, color: "var(--muted-foreground)", flex: 1 }}
				>
					Press 1–{matches.length} to pick
				</span>
				<button
					type="button"
					onClick={onCancel}
					style={{
						fontSize: 11,
						color: "var(--muted-foreground)",
						background: "transparent",
						border: "none",
						cursor: "pointer",
						padding: "2px 6px",
					}}
				>
					Cancel <Kbd>Esc</Kbd>
				</button>
			</PanelFooter>
		</PanelShell>
	);
}

const DEMO_MATCHES: WorkspaceMatch[] = [
	{
		id: "ws-1",
		name: "helmor — feature/auth",
		branch: "feature/auth-hardening",
		rank: 1,
	},
	{ id: "ws-2", name: "helmor — main", branch: "main", rank: 2 },
	{
		id: "ws-3",
		name: "helmor — feature/realtime",
		branch: "feature/realtime-v1",
		rank: 3,
	},
];
