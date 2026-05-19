import { BookMarked } from "lucide-react";

type KbContributedIndicatorProps = {
	isContributed: boolean;
};

export function KbContributedIndicator({
	isContributed,
}: KbContributedIndicatorProps) {
	if (!isContributed) {
		return null;
	}

	return (
		<div className="flex items-center gap-1 text-[10px] text-muted-foreground">
			<BookMarked className="h-3 w-3" />
			<span>Contributed to KB</span>
		</div>
	);
}
