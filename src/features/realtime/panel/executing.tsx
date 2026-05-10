/**
 * Realtime panel — executing state (state 4).
 *
 * Shows live tool results as the agent works through queued actions.
 * Completed tools show a ✓; in-flight tools pulse.
 */
import { Check } from "lucide-react";
import { FootBtn, Tline } from "../primitives";
import type { TlineEntry, ToolResult } from "../types";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelExecutingProps {
	transcript?: TlineEntry[];
	results?: ToolResult[];
	elapsed?: string;
	onStop?: () => void;
	onClose?: () => void;
}

export function RealtimePanelExecuting({
	transcript = DEMO_TRANSCRIPT,
	results = DEMO_RESULTS,
	elapsed = "0:48",
	onStop,
	onClose,
}: RealtimePanelExecutingProps) {
	return (
		<PanelShell height={380}>
			<PanelHeader status="Executing…" elapsed={elapsed} onClose={onClose} />

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

			{/* Tool results */}
			<div
				style={{
					margin: "10px 12px 0",
					borderRadius: 9,
					border: "1px solid var(--border)",
					background: "var(--card)",
					padding: "8px 10px",
					display: "flex",
					flexDirection: "column",
					gap: 7,
				}}
			>
				{results.map((r) => (
					<div
						key={r.label}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							fontSize: 12,
						}}
					>
						{r.done ? (
							<Check
								size={13}
								strokeWidth={2.5}
								style={{ color: "var(--rt-accent)", flexShrink: 0 }}
							/>
						) : (
							<span
								className="pi-dot-pulse"
								style={{
									display: "inline-block",
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: "var(--muted-foreground)",
									flexShrink: 0,
								}}
							/>
						)}
						<span
							style={{
								fontFamily: "var(--font-mono)",
								fontSize: 11,
								color: r.done ? "var(--foreground)" : "var(--muted-foreground)",
								flex: 1,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{r.label}
						</span>
						{r.chip && (
							<span
								style={{
									fontSize: 10,
									fontFamily: "var(--font-mono)",
									background:
										"color-mix(in oklch, var(--muted) 80%, transparent)",
									color: "var(--muted-foreground)",
									borderRadius: 4,
									padding: "1px 5px",
									flexShrink: 0,
								}}
							>
								{r.chip}
							</span>
						)}
					</div>
				))}
			</div>

			<div style={{ flex: 1 }} />

			<PanelFooter>
				<FootBtn danger onClick={onStop}>
					Stop
				</FootBtn>
				<span
					style={{
						fontSize: 11,
						color: "var(--muted-foreground)",
						marginLeft: 4,
					}}
				>
					Running {results.filter((r) => !r.done).length} of {results.length}…
				</span>
			</PanelFooter>
		</PanelShell>
	);
}

const DEMO_TRANSCRIPT: TlineEntry[] = [
	{ who: "you", text: "Run the auth tests and open a PR if they pass." },
	{ who: "rt", text: "Tests passing ✓  Opening PR now…", time: "0:44" },
];

const DEMO_RESULTS: ToolResult[] = [
	{ label: "bun test src/features/auth", done: true, chip: "47 passed" },
	{ label: 'gh pr create --title "feat: auth hardening"', done: false },
];
