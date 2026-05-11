/**
 * Realtime panel — listening state (state 2).
 *
 * Shows the live transcript alongside an animated waveform and a dB level
 * indicator. This state is active while the user or agent is speaking.
 */
import { Tline, Waveform } from "../primitives";
import type { TlineEntry } from "../types";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelListeningProps {
	transcript?: TlineEntry[];
	/** Normalised 0–1 dB level for the level meter */
	level?: number;
	elapsed?: string;
	onClose?: () => void;
}

export function RealtimePanelListening({
	transcript = DEMO_TRANSCRIPT,
	level = 0.72,
	elapsed = "0:08",
	onClose,
}: RealtimePanelListeningProps) {
	return (
		<PanelShell height={340}>
			<PanelHeader status="Listening…" elapsed={elapsed} onClose={onClose} />

			{/* Transcript scroll */}
			<div
				style={{
					flex: 1,
					overflowY: "auto",
					padding: "10px 12px",
					display: "flex",
					flexDirection: "column",
					gap: 6,
				}}
			>
				{transcript.map((entry, i) => (
					<Tline key={i} {...entry} />
				))}
			</div>

			{/* Waveform + level meter */}
			<PanelFooter>
				<div
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					<Waveform bars={22} />
					{/* dB bar */}
					<div
						style={{
							height: 3,
							borderRadius: 99,
							background: "var(--muted)",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								height: "100%",
								width: `${Math.round(level * 100)}%`,
								borderRadius: 99,
								background: "var(--rt-accent)",
								transition: "width 80ms ease",
							}}
						/>
					</div>
				</div>
			</PanelFooter>
		</PanelShell>
	);
}

const DEMO_TRANSCRIPT: TlineEntry[] = [
	{
		who: "you",
		text: "Open the new workspace for feature/auth and check if tests pass.",
	},
	{
		who: "rt",
		text: "On it — switching to feature/auth and running the test suite",
		partial: true,
		time: "0:04",
	},
];
