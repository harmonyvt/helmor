// Skeleton + build-progress display shown while the backend is parsing.

import { Loader2 } from "lucide-react";
import type { CodeGraphBuildProgress } from "@/lib/api";

export function ProgressOverlay({
	progress,
}: {
	progress: CodeGraphBuildProgress | null;
}) {
	const label = describe(progress);
	return (
		<div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-[12px] shadow-md">
				<Loader2 className="size-4 animate-spin text-muted-foreground" />
				<span className="text-foreground">{label}</span>
			</div>
		</div>
	);
}

function describe(progress: CodeGraphBuildProgress | null): string {
	if (!progress) return "Loading workspace graph…";
	switch (progress.phase) {
		case "walking":
			return `Walking workspace — ${progress.discovered} files`;
		case "parsing":
			return `Parsing imports — ${progress.processed} / ${progress.total}`;
		case "resolving":
			return `Resolving edges — ${progress.processed} / ${progress.total}`;
		case "done":
			return "Done";
	}
}
