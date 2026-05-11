/**
 * Panel shell — the floating card that appears above the dock.
 *
 * Rendered via a React portal (document.body) so it escapes the sidebar's
 * overflow:hidden. Positioned with position:fixed at left:12px, bottom:56px.
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { RTGlyph } from "../primitives";

const RT_MODEL_LABEL = "Azure · gpt-realtime-2";

// ─── PanelHeader ─────────────────────────────────────────────────────────────

interface PanelHeaderProps {
	status?: string;
	elapsed?: string;
	onClose?: () => void;
}

export function PanelHeader({ status, elapsed, onClose }: PanelHeaderProps) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "10px 12px 9px",
				borderBottom: "1px solid var(--border)",
				flexShrink: 0,
			}}
		>
			<RTGlyph size={14} animated />

			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}
				>
					<span
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: "var(--foreground)",
							letterSpacing: "-0.01em",
						}}
					>
						Realtime
					</span>
					{status && (
						<span
							className="helmor-shimmer-text"
							style={{ fontSize: 11, fontWeight: 500 }}
						>
							{status}
						</span>
					)}
				</div>
				<div
					style={{
						fontSize: 10,
						color: "var(--muted-foreground)",
						marginTop: 1,
					}}
				>
					{RT_MODEL_LABEL}
				</div>
			</div>

			{elapsed && (
				<span
					style={{
						fontSize: 10,
						fontFamily: "var(--font-mono)",
						color: "var(--muted-foreground)",
						background: "var(--muted)",
						borderRadius: 4,
						padding: "1px 5px",
						letterSpacing: "0.03em",
					}}
				>
					{elapsed}
				</span>
			)}

			<button
				type="button"
				aria-label="Close Realtime panel"
				onClick={onClose}
				style={{
					width: 22,
					height: 22,
					borderRadius: 5,
					border: "1px solid var(--border)",
					background: "transparent",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					color: "var(--muted-foreground)",
					flexShrink: 0,
				}}
			>
				<X size={12} strokeWidth={2.2} />
			</button>
		</div>
	);
}

// ─── PanelFooter ─────────────────────────────────────────────────────────────

interface PanelFooterProps {
	children: ReactNode;
}

export function PanelFooter({ children }: PanelFooterProps) {
	return (
		<div
			style={{
				borderTop: "1px solid var(--border)",
				background: "color-mix(in oklch, var(--muted) 50%, transparent)",
				padding: "8px 12px",
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexShrink: 0,
			}}
		>
			{children}
		</div>
	);
}

// ─── PanelShell ──────────────────────────────────────────────────────────────

interface PanelShellProps {
	children: ReactNode;
	/** Extra pixels of height (default 380) */
	height?: number;
}

/**
 * The outer floating card. Portals to document.body so it escapes
 * the sidebar's overflow:hidden clipping context.
 */
export function PanelShell({ children, height = 380 }: PanelShellProps) {
	const panel = (
		<div
			style={{
				position: "fixed",
				left: 12,
				bottom: 56,
				width: 380,
				zIndex: 200,
				borderRadius: 14,
				background: "var(--popover)",
				boxShadow: [
					"0 0 0 1px color-mix(in oklch, var(--rt-accent) 18%, transparent)",
					"0 12px 32px -6px rgba(0,0,0,0.22)",
					"0 4px 12px -4px rgba(0,0,0,0.14)",
				].join(", "),
				height,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			{children}
		</div>
	);

	return createPortal(panel, document.body);
}
