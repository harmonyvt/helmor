import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	CheckCircle2,
	Database,
	LoaderCircle,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { reindexProjectKnowledge } from "@/lib/api";
import {
	knowledgeStatusQueryOptions,
	repositoriesQueryOptions,
} from "@/lib/query-client";
import { SettingsGroup, SettingsRow } from "../components/settings-row";

function StateIcon({ state }: { state: string }) {
	if (state === "running") {
		return (
			<CheckCircle2
				className="size-3.5 text-green-600 dark:text-green-400"
				strokeWidth={2}
			/>
		);
	}
	if (state === "stopped") {
		return (
			<AlertCircle
				className="size-3.5 text-amber-600 dark:text-amber-400"
				strokeWidth={2}
			/>
		);
	}
	return <XCircle className="size-3.5 text-muted-foreground" strokeWidth={2} />;
}

function StateBadge({ state }: { state: string }) {
	const colorClass =
		state === "running"
			? "text-green-600 dark:text-green-400"
			: state === "stopped"
				? "text-amber-600 dark:text-amber-400"
				: "text-muted-foreground";

	return (
		<span
			className={`flex items-center gap-1 text-[12px] font-medium ${colorClass}`}
		>
			<StateIcon state={state} />
			{state.charAt(0).toUpperCase() + state.slice(1)}
		</span>
	);
}

export function KnowledgeSettingsPanel() {
	const statusQuery = useQuery(knowledgeStatusQueryOptions());
	const reposQuery = useQuery(repositoriesQueryOptions());

	const reindexMutation = useMutation({
		mutationFn: (repoId: string) => reindexProjectKnowledge(repoId),
	});

	const status = statusQuery.data;
	const repos = reposQuery.data ?? [];

	return (
		<div className="flex flex-col gap-4">
			{/* Status card */}
			<div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
				<div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
					<Database className="size-3.5" strokeWidth={1.8} />
					Knowledge base status
				</div>

				{statusQuery.isPending ? (
					<Skeleton className="h-16 w-full" />
				) : statusQuery.isError ? (
					<div className="text-[12px] text-destructive">
						Failed to load knowledge status.
					</div>
				) : status ? (
					<div className="grid gap-1.5 text-[12px] text-muted-foreground">
						<div className="flex items-center gap-3">
							<span className="w-24 shrink-0 text-muted-foreground/70">
								Sidecar
							</span>
							<StateBadge state={status.state} />
						</div>
						<div className="flex items-center gap-3">
							<span className="w-24 shrink-0 text-muted-foreground/70">
								CocoIndex
							</span>
							{status.cocoIndexAvailable ? (
								<span className="flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
									<CheckCircle2 className="size-3.5" strokeWidth={2} />
									Available
								</span>
							) : (
								<span className="flex items-center gap-1 font-medium text-destructive">
									<XCircle className="size-3.5" strokeWidth={2} />
									Unavailable
								</span>
							)}
						</div>
						<div className="flex items-center gap-3">
							<span className="w-24 shrink-0 text-muted-foreground/70">
								Documents
							</span>
							<span className="tabular-nums">{status.documentCount}</span>
						</div>
						<div className="flex items-start gap-3">
							<span className="w-24 shrink-0 text-muted-foreground/70">
								Data dir
							</span>
							<span className="min-w-0 break-all font-mono text-[11px]">
								{status.dataDir}
							</span>
						</div>
					</div>
				) : null}
			</div>

			{/* CocoIndex unavailable warning */}
			{status?.cocoIndexAvailable === false && (
				<div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
					CocoIndex is not installed. The knowledge base uses keyword matching
					only. Install CocoIndex for improved retrieval accuracy.
				</div>
			)}

			{/* Per-repo reindex section */}
			{repos.length > 0 && (
				<SettingsGroup>
					<div className="pb-1 pt-4 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">
						Project knowledge indexes
					</div>
					{repos.map((repo) => {
						const isPending =
							reindexMutation.isPending &&
							reindexMutation.variables === repo.id;

						return (
							<SettingsRow
								key={repo.id}
								title={repo.name}
								description={
									reindexMutation.isSuccess &&
									reindexMutation.variables === repo.id
										? `Reindexed just now`
										: `Last indexed: unknown`
								}
							>
								<Button
									variant="outline"
									size="sm"
									disabled={reindexMutation.isPending}
									onClick={() => reindexMutation.mutate(repo.id)}
									className="cursor-pointer"
								>
									{isPending ? (
										<LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
									) : (
										<RefreshCw className="mr-1.5 size-3.5" />
									)}
									Reindex
								</Button>
							</SettingsRow>
						);
					})}
				</SettingsGroup>
			)}

			{repos.length === 0 && !reposQuery.isPending && (
				<div className="text-[12px] text-muted-foreground">
					No repositories found. Add a repository to enable per-project
					knowledge indexing.
				</div>
			)}
		</div>
	);
}
