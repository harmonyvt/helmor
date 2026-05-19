import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { knowledgeStatusQueryOptions } from "@/lib/query-client";

type KbActivePillProps = {
	goalWorkspaceId: string;
};

export function KbActivePill({
	goalWorkspaceId: _goalWorkspaceId,
}: KbActivePillProps) {
	const { data: status } = useQuery(knowledgeStatusQueryOptions());

	if (status?.state !== "running" || !(status.documentCount > 0)) {
		return null;
	}

	return (
		<div className="flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400 transition-opacity duration-200">
			<Database className="h-3 w-3" />
			<span>KB active · {status.documentCount} docs</span>
		</div>
	);
}
