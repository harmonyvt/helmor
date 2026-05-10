/**
 * Realtime panel — model-pick state (state 6).
 *
 * Lets the user switch the active model mid-session.
 * Pressing 1-4 selects; ↵ confirms the highlighted option.
 */
import { Check } from "lucide-react";
import { FootBtn, Kbd } from "../primitives";
import type { ModelOption } from "../types";
import { PanelFooter, PanelHeader, PanelShell } from "./shell";

interface RealtimePanelModelPickProps {
	models?: ModelOption[];
	onPick?: (id: string) => void;
	onSetDefault?: (id: string) => void;
	onCancel?: () => void;
	onClose?: () => void;
}

export function RealtimePanelModelPick({
	models = DEMO_MODELS,
	onPick,
	onSetDefault,
	onCancel,
	onClose,
}: RealtimePanelModelPickProps) {
	const chosen = models.find((m) => m.chosen);

	return (
		<PanelShell height={320}>
			<PanelHeader status="Switch model" onClose={onClose} />

			<div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
				{models.map((m, i) => (
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
							background: m.chosen
								? "color-mix(in oklch, var(--rt-accent) 8%, transparent)"
								: "transparent",
							border: "none",
							cursor: "pointer",
							textAlign: "left",
						}}
						onMouseEnter={(e) => {
							if (!m.chosen)
								(e.currentTarget as HTMLElement).style.background =
									"var(--accent)";
						}}
						onMouseLeave={(e) => {
							if (!m.chosen)
								(e.currentTarget as HTMLElement).style.background =
									"transparent";
						}}
					>
						<Kbd>{i + 1}</Kbd>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									fontSize: 13,
									fontWeight: m.chosen ? 600 : 500,
									color: m.chosen ? "var(--rt-accent)" : "var(--foreground)",
									display: "flex",
									alignItems: "center",
									gap: 5,
								}}
							>
								{m.label}
								{m.isDefault && (
									<span
										style={{
											fontSize: 9,
											fontWeight: 600,
											letterSpacing: "0.04em",
											textTransform: "uppercase",
											color: "var(--muted-foreground)",
											background: "var(--muted)",
											borderRadius: 3,
											padding: "1px 4px",
										}}
									>
										default
									</span>
								)}
							</div>
							<div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
								{m.provider}
							</div>
						</div>
						{m.chosen && (
							<Check
								size={14}
								strokeWidth={2.5}
								style={{ color: "var(--rt-accent)", flexShrink: 0 }}
							/>
						)}
					</button>
				))}
			</div>

			<PanelFooter>
				<FootBtn
					primary
					onClick={() => chosen && onSetDefault?.(chosen.id)}
					disabled={!chosen}
				>
					Set default ↵
				</FootBtn>
				<button
					type="button"
					onClick={onCancel}
					style={{
						marginLeft: "auto",
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

const DEMO_MODELS: ModelOption[] = [
	{
		id: "gpt-realtime-2",
		label: "GPT Realtime 2",
		provider: "Azure",
		chosen: true,
	},
	{
		id: "gpt-realtime-1.5",
		label: "GPT Realtime 1.5",
		provider: "Azure",
		isDefault: true,
	},
	{
		id: "claude-sonnet-4-5",
		label: "Claude Sonnet 4.5",
		provider: "Anthropic",
	},
	{ id: "gpt-4o-realtime", label: "GPT-4o Realtime", provider: "OpenAI" },
];
