/**
 * Realtime surface primitive components.
 *
 * All of these are tiny, dependency-free building blocks used across
 * the dock and panel states. They rely on CSS variables set by the
 * parent container (--rt-accent, --rt-speaker-color, etc.).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ActionEntry, TlineEntry } from "./types";

// ─── RTGlyph ────────────────────────────────────────────────────────────────

interface RTGlyphProps {
	size?: number;
	/** When true, the dot pulses with pi-dot-pulse animation */
	animated?: boolean;
	className?: string;
}

/**
 * A small filled circle in the rt-accent color.
 * Used as the provider glyph in the dock row and panel header.
 */
export function RTGlyph({
	size = 16,
	animated = false,
	className,
}: RTGlyphProps) {
	return (
		<span
			className={className}
			style={{
				display: "inline-block",
				width: size,
				height: size,
				borderRadius: "50%",
				background: "var(--rt-accent)",
				flexShrink: 0,
				...(animated && {
					animationName: "pi-pulse",
					animationDuration: "2.4s",
					animationTimingFunction: "ease-in-out",
					animationIterationCount: "infinite",
				}),
			}}
		/>
	);
}

// ─── Kbd ────────────────────────────────────────────────────────────────────

interface KbdProps {
	children: ReactNode;
}

/** Styled keyboard shortcut badge (mono font, card bg, border). */
export function Kbd({ children }: KbdProps) {
	return (
		<kbd
			style={{
				fontFamily: "var(--font-mono)",
				fontSize: 10,
				fontWeight: 500,
				background: "var(--card)",
				border: "1px solid var(--border)",
				borderRadius: 4,
				padding: "1px 4px",
				color: "var(--muted-foreground)",
				lineHeight: 1.5,
				letterSpacing: "0.01em",
				userSelect: "none",
			}}
		>
			{children}
		</kbd>
	);
}

// ─── Waveform ────────────────────────────────────────────────────────────────

interface WaveformProps {
	bars?: number;
}

/**
 * Animated audio waveform — a row of narrow bars that scale up/down
 * at staggered offsets using the pi-wave CSS animation.
 * Bar color is driven by --rt-speaker-color.
 */
export function Waveform({ bars = 18 }: WaveformProps) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 2, height: 14 }}>
			{Array.from({ length: bars }).map((_, i) => (
				<span
					key={i}
					className="pi-wave-bar"
					style={{ animationDelay: `${i * 110}ms` }}
				/>
			))}
		</div>
	);
}

// ─── Tline ──────────────────────────────────────────────────────────────────

/** A single transcript line in the panel. */
export function Tline({ who, text, partial, time }: TlineEntry) {
	const isUser = who === "you";
	return (
		<div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
			<span
				style={{
					fontSize: 10,
					fontWeight: 600,
					letterSpacing: "0.04em",
					textTransform: "uppercase",
					color: isUser ? "var(--muted-foreground)" : "var(--rt-accent)",
					marginTop: 1,
					minWidth: 18,
					flexShrink: 0,
				}}
			>
				{isUser ? "you" : "rt"}
			</span>
			<span
				style={{
					fontSize: 13,
					lineHeight: 1.5,
					color: partial ? "var(--muted-foreground)" : "var(--foreground)",
					flex: 1,
				}}
			>
				{text}
				{partial && (
					<span
						style={{
							display: "inline-block",
							width: 8,
							height: 13,
							background: "var(--muted-foreground)",
							borderRadius: 2,
							marginLeft: 3,
							verticalAlign: "text-bottom",
							opacity: 0.6,
							animation: "pi-pulse 0.9s ease-in-out infinite",
						}}
					/>
				)}
			</span>
			{time && (
				<span
					style={{
						fontSize: 10,
						color: "var(--muted-foreground)",
						opacity: 0.6,
						flexShrink: 0,
						marginTop: 2,
						fontFamily: "var(--font-mono)",
					}}
				>
					{time}
				</span>
			)}
		</div>
	);
}

// ─── ActionLine ──────────────────────────────────────────────────────────────

/** A queued action item with a number, verb badge, and detail. */
export function ActionLine({ n, verb, detail }: ActionEntry) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
			}}
		>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					fontSize: 10,
					color: "var(--muted-foreground)",
					minWidth: 14,
					textAlign: "right",
				}}
			>
				{n}
			</span>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					fontSize: 10,
					fontWeight: 600,
					background: "color-mix(in oklch, var(--rt-accent) 16%, transparent)",
					color: "var(--rt-accent)",
					borderRadius: 4,
					padding: "1px 5px",
					letterSpacing: "0.03em",
				}}
			>
				{verb}
			</span>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					fontSize: 11,
					color: "var(--foreground)",
					flex: 1,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{detail}
			</span>
		</div>
	);
}

// ─── FootBtn ─────────────────────────────────────────────────────────────────

interface FootBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	primary?: boolean;
	danger?: boolean;
}

/** Panel footer button — three variants: default (card bg), primary, danger. */
export function FootBtn({
	children,
	primary,
	danger,
	style,
	...rest
}: FootBtnProps) {
	let bg = "var(--card)";
	let color = "var(--foreground)";
	let border = "1px solid var(--border)";

	if (primary) {
		bg = "var(--primary)";
		color = "var(--primary-foreground)";
		border = "none";
	} else if (danger) {
		bg = "color-mix(in oklch, var(--destructive) 12%, transparent)";
		color = "var(--destructive)";
		border =
			"1px solid color-mix(in oklch, var(--destructive) 40%, transparent)";
	}

	return (
		<button
			type="button"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				padding: "4px 10px",
				fontSize: 12,
				fontWeight: 500,
				borderRadius: 7,
				border,
				background: bg,
				color,
				cursor: "pointer",
				lineHeight: 1.4,
				transition: "opacity 120ms ease",
				...style,
			}}
			{...rest}
		>
			{children}
		</button>
	);
}
