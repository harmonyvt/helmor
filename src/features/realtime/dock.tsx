/**
 * RealtimeDock — the persistent row in the left sidebar above the settings row.
 *
 * - Idle: transparent border, "Realtime" label, ⌘⇧R keyboard hint
 * - Live: animated gradient (pi-dock-live), LIVE pill, mic + hangup controls
 *
 * The dock never disappears — it's the entry point for the Realtime session.
 */
import { MicOff, PhoneOff } from "lucide-react";
import { Kbd, RTGlyph } from "./primitives";
import type { RealtimeState } from "./types";

// ─── DockControls ────────────────────────────────────────────────────────────

interface DockControlsProps {
	muted?: boolean;
	onMuteToggle?: () => void;
	onHangup?: () => void;
}

/**
 * Inline mic + hangup buttons shown only when a session is live.
 * stopPropagation prevents the dock row's onClick from firing.
 */
function DockControls({ muted, onMuteToggle, onHangup }: DockControlsProps) {
	return (
		<div
			style={{ display: "flex", alignItems: "center", gap: 4 }}
			onClick={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				aria-label={muted ? "Unmute microphone" : "Mute microphone"}
				onClick={onMuteToggle}
				style={{
					width: 22,
					height: 22,
					borderRadius: 5,
					border: "1px solid var(--border)",
					background: muted
						? "color-mix(in oklch, var(--rt-accent) 14%, transparent)"
						: "var(--card)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					color: muted ? "var(--rt-accent)" : "var(--muted-foreground)",
					flexShrink: 0,
				}}
			>
				<MicOff size={11} strokeWidth={2} />
			</button>
			<button
				type="button"
				aria-label="Disconnect session"
				onClick={onHangup}
				style={{
					width: 22,
					height: 22,
					borderRadius: 5,
					border:
						"1px solid color-mix(in oklch, var(--destructive) 40%, transparent)",
					background:
						"color-mix(in oklch, var(--destructive) 10%, transparent)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					color: "var(--destructive)",
					flexShrink: 0,
				}}
			>
				<PhoneOff size={11} strokeWidth={2} />
			</button>
		</div>
	);
}

// ─── RealtimeDock ────────────────────────────────────────────────────────────

export interface RealtimeDockProps {
	state: RealtimeState;
	muted?: boolean;
	onClick?: () => void;
	onMuteToggle?: () => void;
	onHangup?: () => void;
}

/**
 * The dock row rendered inside the sidebar, just above the settings row.
 * Separated from the workspace list by a top border.
 */
export function RealtimeDock({
	state,
	muted,
	onClick,
	onMuteToggle,
	onHangup,
}: RealtimeDockProps) {
	const isLive = state !== "idle";

	return (
		<div
			onClick={onClick}
			role="button"
			tabIndex={0}
			aria-label="Toggle Realtime panel"
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick?.();
				}
			}}
			className={isLive ? "pi-dock-live" : undefined}
			style={{
				margin: "0 8px 6px",
				borderRadius: 8,
				border: "1px solid",
				borderColor: isLive ? undefined : "var(--border)",
				padding: "5px 8px",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				gap: 7,
				transition: "border-color 0.2s, background 0.2s",
				userSelect: "none",
				minHeight: 32,
			}}
		>
			<RTGlyph size={12} animated={isLive} />

			<span
				style={{
					flex: 1,
					fontSize: 12,
					fontWeight: 500,
					color: "var(--foreground)",
					letterSpacing: "0.01em",
				}}
			>
				Realtime
			</span>

			{isLive ? (
				<>
					<span
						style={{
							fontSize: 9,
							fontWeight: 700,
							letterSpacing: "0.07em",
							color: "var(--rt-accent)",
							textTransform: "uppercase",
							opacity: 0.9,
						}}
					>
						LIVE
					</span>
					<DockControls
						muted={muted}
						onMuteToggle={onMuteToggle}
						onHangup={onHangup}
					/>
				</>
			) : (
				<Kbd>⌘⇧R</Kbd>
			)}
		</div>
	);
}
