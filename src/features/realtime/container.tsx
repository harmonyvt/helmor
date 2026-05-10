/**
 * RealtimeContainer — stateful entry point for the Realtime surface.
 *
 * Renders:
 * 1. The RealtimeDock row (always visible, slotted into the sidebar)
 * 2. The floating panel (portal to document.body) when open
 * 3. The ambient glow overlay (portal) when a session is live
 *
 * V1: frontend scaffolding only. The dock cycles through demo states
 * on successive panel opens so all panel states can be previewed
 * during development. Real session plumbing is deferred to V2.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RealtimeDock } from "./dock";
import { RealtimePanelActionPreview } from "./panel/action-preview";
import { RealtimePanelExecuting } from "./panel/executing";
import { RealtimePanelIdle } from "./panel/idle";
import { RealtimePanelListening } from "./panel/listening";
import { RealtimePanelModelPick } from "./panel/model-pick";
import { RealtimePanelSidecar } from "./panel/sidecar";
import { RealtimePanelWorkspacePick } from "./panel/workspace-pick";
import type { RealtimeState } from "./types";

// Demo states cycle on repeated opens (V1 development preview only)
const DEMO_STATES: RealtimeState[] = [
	"idle",
	"listening",
	"action-preview",
	"executing",
	"workspace-pick",
	"model-pick",
	"sidecar",
];

export function RealtimeContainer() {
	const [open, setOpen] = useState(false);
	const [stateIdx, setStateIdx] = useState(0);
	const [muted, setMuted] = useState(false);

	const currentState = DEMO_STATES[stateIdx % DEMO_STATES.length];
	const isLive = currentState !== "idle";

	// ⌘⇧R global toggle
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (
				(e.metaKey || e.ctrlKey) &&
				e.shiftKey &&
				e.key.toLowerCase() === "r"
			) {
				e.preventDefault();
				handleToggle();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleToggle = useCallback(() => {
		setOpen((prev) => {
			if (!prev) {
				// Advance demo state on each open
				setStateIdx((idx) => idx + 1);
			}
			return !prev;
		});
	}, []);

	const handleClose = useCallback(() => setOpen(false), []);
	const handleHangup = useCallback(() => {
		setStateIdx(0); // back to idle
		setOpen(false);
	}, []);

	function renderPanel() {
		if (!open) return null;

		const commonProps = { onClose: handleClose };

		switch (currentState) {
			case "idle":
				return (
					<RealtimePanelIdle {...commonProps} onStart={() => setStateIdx(1)} />
				);
			case "listening":
				return <RealtimePanelListening {...commonProps} />;
			case "action-preview":
				return (
					<RealtimePanelActionPreview
						{...commonProps}
						onConfirm={() => setStateIdx(DEMO_STATES.indexOf("executing"))}
						onCancel={handleClose}
					/>
				);
			case "executing":
				return (
					<RealtimePanelExecuting {...commonProps} onStop={handleHangup} />
				);
			case "workspace-pick":
				return (
					<RealtimePanelWorkspacePick
						{...commonProps}
						onPick={handleClose}
						onCancel={handleClose}
					/>
				);
			case "model-pick":
				return (
					<RealtimePanelModelPick
						{...commonProps}
						onPick={handleClose}
						onSetDefault={handleClose}
						onCancel={handleClose}
					/>
				);
			case "sidecar":
				return <RealtimePanelSidecar {...commonProps} />;
			default:
				return null;
		}
	}

	// Ambient glow overlay — portaled to body, fixed position at bottom-left
	function renderGlow() {
		if (!isLive) return null;

		return createPortal(
			<>
				{/* Radial spill */}
				<div
					className="pi-glow-breath"
					aria-hidden="true"
					style={{
						position: "fixed",
						left: -60,
						bottom: -80,
						width: 480,
						height: 360,
						borderRadius: "50%",
						background:
							"radial-gradient(ellipse at center, var(--rt-speaker-color, var(--rt-accent)) 0%, transparent 70%)",
						filter: "blur(28px)",
						mixBlendMode: "screen",
						pointerEvents: "none",
						zIndex: 1,
					}}
				/>
				{/* Floor tint */}
				<div
					className="pi-glow-breath-delay"
					aria-hidden="true"
					style={{
						position: "fixed",
						left: 0,
						right: 0,
						bottom: 0,
						height: 160,
						background:
							"linear-gradient(to top, color-mix(in oklch, var(--rt-speaker-color, var(--rt-accent)) 8%, transparent), transparent)",
						pointerEvents: "none",
						zIndex: 1,
					}}
				/>
			</>,
			document.body,
		);
	}

	return (
		<>
			<RealtimeDock
				state={currentState}
				muted={muted}
				onClick={handleToggle}
				onMuteToggle={() => setMuted((m) => !m)}
				onHangup={handleHangup}
			/>
			{renderPanel()}
			{renderGlow()}
		</>
	);
}
