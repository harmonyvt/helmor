import { ArrowRight } from "lucide-react";
import type { AgentProvider, ProviderSwitchDividerPart } from "@/lib/api";

const PROVIDER_LABELS: Record<AgentProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	pi: "Pi",
};

function providerLabel(provider: AgentProvider): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

export function ProviderSwitchDivider({
	part,
}: {
	part: ProviderSwitchDividerPart;
}) {
	const fromLabel = providerLabel(part.fromProvider);
	const toLabel = providerLabel(part.toProvider);

	return (
		<div
			data-testid="provider-switch-divider"
			className="my-2 flex items-center gap-2 py-1"
		>
			<div className="h-px flex-1 bg-border/50" />
			<div className="flex shrink-0 items-center gap-1 text-[11px] leading-none text-muted-foreground/70">
				<span>{fromLabel}</span>
				<ArrowRight className="size-3 shrink-0" strokeWidth={1.5} />
				<span>{toLabel}</span>
			</div>
			<div className="h-px flex-1 bg-border/50" />
		</div>
	);
}
