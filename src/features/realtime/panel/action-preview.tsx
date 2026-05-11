/**
 * Realtime panel — action-preview state (state 3).
 *
 * Shows the transcript plus a card listing the queued agentic actions
 * that the agent is about to execute. User can confirm or cancel.
 */
import { ActionLine, FootBtn, Tline } from "../primitives";
import type { ActionEntry, TlineEntry } from "../types";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelActionPreviewProps {
	transcript?: TlineEntry[];
	actions?: ActionEntry[];
	elapsed?: string;
	eta?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
	onClose?: () => void;
}

export function RealtimePanelActionPreview({
	transcript = DEMO_TRANSCRIPT,
	actions = DEMO_ACTIONS,
	elapsed = "0:22",
	eta = "~1m 40s",
	onConfirm,
	onCancel,
	onClose,
}: RealtimePanelActionPreviewProps) {
	return (
		<PanelShell height={380}>
			<PanelHeader
				status="Action preview"
				elapsed={elapsed}
				onClose={onClose}
			/>

			{/* Transcript */}
			<div
				style={{
					padding: "10px 12px 0",
					display: "flex",
					flexDirection: "column",
					gap: 5,
				}}
			>
				{transcript.map((entry, i) => (
					<Tline key={i} {...entry} />
				))}
			</div>

			{/* Actions card */}
			<div
				style={{
					margin: "10px 12px 0",
					borderRadius: 9,
					border: "1px solid var(--border)",
					background: "var(--card)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "8px 10px",
						borderBottom: "1px solid var(--border)",
						display: "flex",
						alignItems: "center",
						gap: 8,
					}}
				>
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "var(--foreground)",
						}}
					>
						{actions.length} actions queued
					</span>
					<span
						style={{
							marginLeft: "auto",
							fontSize: 10,
							color: "var(--muted-foreground)",
							fontFamily: "var(--font-mono)",
						}}
					>
						ETA {eta}
					</span>
				</div>
				<div
					style={{
						padding: "8px 10px",
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					{actions.map((a) => (
						<ActionLine key={a.n} {...a} />
					))}
				</div>
			</div>

			<div style={{ flex: 1 }} />

			<PanelFooter>
				<FootBtn primary onClick={onConfirm}>
					Confirm ↵
				</FootBtn>
				<FootBtn danger onClick={onCancel}>
					Cancel Esc
				</FootBtn>
			</PanelFooter>
		</PanelShell>
	);
}

const DEMO_TRANSCRIPT: TlineEntry[] = [
	{ who: "you", text: "Run the auth tests and open a PR if they pass." },
	{
		who: "rt",
		text: "I'll run the tests and open the PR automatically. Ready to start:",
		time: "0:18",
	},
];

const DEMO_ACTIONS: ActionEntry[] = [
	{ n: 1, verb: "run", detail: "bun test src/features/auth" },
	{ n: 2, verb: "open", detail: 'gh pr create --title "feat: auth hardening"' },
];
