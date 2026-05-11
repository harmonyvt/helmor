/**
 * Realtime panel — idle state.
 *
 * Shown when the panel is open but no session is active.
 * Provides a "Start session" call-to-action and keyboard hint.
 */
import { FootBtn } from "../primitives";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelIdleProps {
	onClose?: () => void;
	onStart?: () => void;
}

export function RealtimePanelIdle({
	onClose,
	onStart,
}: RealtimePanelIdleProps) {
	return (
		<PanelShell height={220}>
			<PanelHeader onClose={onClose} />
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 10,
					padding: "0 24px",
				}}
			>
				<span
					style={{
						fontSize: 13,
						color: "var(--muted-foreground)",
						textAlign: "center",
						lineHeight: 1.5,
					}}
				>
					Start a voice session powered by{" "}
					<span style={{ color: "var(--foreground)", fontWeight: 500 }}>
						Azure · gpt-realtime-2
					</span>
				</span>
				<span
					style={{
						fontSize: 11,
						color: "var(--muted-foreground)",
						opacity: 0.6,
					}}
				>
					Hold{" "}
					<kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
						Space
					</kbd>{" "}
					to push-to-talk ·{" "}
					<kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
						Esc
					</kbd>{" "}
					to cancel
				</span>
			</div>
			<PanelFooter>
				<FootBtn primary onClick={onStart}>
					Start session
				</FootBtn>
				<FootBtn onClick={onClose} style={{ marginLeft: "auto" }}>
					Cancel
				</FootBtn>
			</PanelFooter>
		</PanelShell>
	);
}
