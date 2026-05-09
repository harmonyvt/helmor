import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { GenericCardPart } from "@/lib/api";
import { cn } from "@/lib/utils";

function detailsText(details: unknown): string | null {
	if (details === undefined || details === null) return null;
	if (typeof details === "string") return details;
	try {
		return JSON.stringify(details, null, 2);
	} catch {
		return String(details);
	}
}

export function GenericCard({ part }: { part: GenericCardPart }) {
	const severity = part.severity ?? "info";
	const Icon =
		severity === "error"
			? AlertCircle
			: severity === "warning"
				? AlertTriangle
				: Info;
	const detail = detailsText(part.details);

	return (
		<div
			className={cn(
				"my-1 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm",
				severity === "error" && "border-destructive/40 bg-destructive/5",
				severity === "warning" && "border-chart-5/40 bg-chart-5/5",
			)}
		>
			<div className="flex min-w-0 items-start gap-2">
				<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="truncate font-medium text-foreground">
							{part.title}
						</span>
						{part.provider ? (
							<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
								{part.provider}
							</span>
						) : null}
						{part.status ? (
							<span className="text-xs text-muted-foreground">
								{part.status}
							</span>
						) : null}
					</div>
					{part.subtitle ? (
						<div className="mt-0.5 truncate text-xs text-muted-foreground">
							{part.subtitle}
						</div>
					) : null}
					{part.body ? (
						<div className="mt-2 whitespace-pre-wrap text-muted-foreground">
							{part.body}
						</div>
					) : null}
					{detail ? (
						<details className="mt-2 text-xs text-muted-foreground">
							<summary className="cursor-pointer select-none">Details</summary>
							<pre className="mt-2 max-h-72 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
								{detail}
							</pre>
						</details>
					) : null}
				</div>
			</div>
		</div>
	);
}
