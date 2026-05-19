import { Database, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

type KnowledgeEmptyStateProps = {
	variant: "no-index" | "no-results";
	query?: string;
	onReindex?: () => void;
	isReindexing?: boolean;
};

export function KnowledgeEmptyState({
	variant,
	query,
	onReindex,
	isReindexing,
}: KnowledgeEmptyStateProps) {
	if (variant === "no-index") {
		return (
			<Empty className="py-12">
				<EmptyHeader>
					<EmptyMedia>
						<Database className="h-8 w-8 text-muted-foreground/40" />
					</EmptyMedia>
					<EmptyTitle>No knowledge indexed yet</EmptyTitle>
					<EmptyDescription>
						Run Reindex to scan your project and goal documents.
					</EmptyDescription>
				</EmptyHeader>
				{onReindex && (
					<EmptyContent>
						<Button
							size="sm"
							onClick={onReindex}
							disabled={isReindexing}
							className="cursor-pointer"
						>
							Reindex now
						</Button>
					</EmptyContent>
				)}
			</Empty>
		);
	}

	return (
		<Empty className="py-12">
			<EmptyHeader>
				<EmptyMedia>
					<SearchX className="h-8 w-8 text-muted-foreground/40" />
				</EmptyMedia>
				<EmptyTitle>No results for &ldquo;{query ?? "…"}&rdquo;</EmptyTitle>
				<EmptyDescription>
					Try broader terms or switch the namespace filter.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
