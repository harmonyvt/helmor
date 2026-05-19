import { Clipboard } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { KnowledgeMatch } from "@/lib/api";
import { KnowledgeSourceBadge } from "./knowledge-source-badge";

type KnowledgeDetailPaneProps = {
	match: KnowledgeMatch | null;
};

export function KnowledgeDetailPane({ match }: KnowledgeDetailPaneProps) {
	if (!match) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Select an entry to view details
			</div>
		);
	}

	const metaEntries = Object.entries(match.metadata ?? {});

	function handleCopy() {
		void navigator.clipboard.writeText(match!.excerpt);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex items-center gap-2 p-3 pb-2 flex-wrap">
				<KnowledgeSourceBadge sourceType={match.sourceType} />
				{match.goalWorkspaceId ? (
					<span className="text-[10px] font-medium text-blue-500 dark:text-blue-400 rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0">
						Goal
					</span>
				) : (
					<span className="text-[10px] font-medium text-muted-foreground rounded-full border border-border/40 bg-muted/40 px-1.5 py-0">
						Project
					</span>
				)}
				<span className="text-sm font-semibold text-foreground min-w-0 flex-1 truncate">
					{match.title}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleCopy}
					className="h-7 w-7 p-0 cursor-pointer shrink-0"
					title="Copy excerpt"
				>
					<Clipboard className="h-3.5 w-3.5" />
				</Button>
			</div>
			<Separator />
			<ScrollArea className="flex-1">
				<div className="p-3 space-y-3">
					<pre className="whitespace-pre-wrap text-xs text-muted-foreground font-mono leading-relaxed p-3 bg-muted/20 rounded-md">
						{match.excerpt}
					</pre>
					{metaEntries.length > 0 && (
						<dl className="text-xs text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
							{metaEntries.map(([key, value]) => (
								<Fragment key={key}>
									<dt className="font-medium text-foreground/70 truncate">
										{key}
									</dt>
									<dd className="truncate">{String(value)}</dd>
								</Fragment>
							))}
						</dl>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
