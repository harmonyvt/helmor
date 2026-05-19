/**
 * AgentToolsSection — inspector tab showing all registered Pi tools and the
 * Helmor Skills install status for Claude / Codex.
 *
 * Pi tools are documented inline from pi-knowledge-tools.ts and
 * pi-workspace-tools.ts. Helmor Skills are fetched live via IPC.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
	Activity,
	Bot,
	CheckCircle2,
	CheckSquare2,
	FileSearch,
	GitBranch,
	GitMerge,
	LayoutList,
	LoaderCircle,
	PenLine,
	Puzzle,
	RefreshCw,
	Search,
	Target,
	Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getHelmorSkillsStatus, installHelmorSkills } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Static tool registry ──────────────────────────────────────────────────────

type ToolDef = {
	icon: LucideIcon;
	label: string;
	name: string;
	description: string;
};

const PI_KNOWLEDGE_TOOLS: ToolDef[] = [
	{
		icon: Search,
		label: "Search Knowledge",
		name: "search_knowledge",
		description:
			"Scoped search across project and goal knowledge. Use scope=all | project | goal.",
	},
	{
		icon: Activity,
		label: "Knowledge Status",
		name: "get_knowledge_status",
		description:
			"Check whether the sidecar is running and how many documents are indexed.",
	},
	{
		icon: RefreshCw,
		label: "Reindex Knowledge",
		name: "reindex_knowledge",
		description:
			"Refresh the knowledge index for the current project, goal, or both.",
	},
	{
		icon: FileSearch,
		label: "Query Project Knowledge",
		name: "query_project_knowledge",
		description:
			"Search the long-lived project knowledge base for code, docs, and conventions.",
	},
	{
		icon: Target,
		label: "Query Goal Knowledge",
		name: "query_goal_knowledge",
		description:
			"Search this goal's overlay: brief, cards, Pi notes, and assignee reports.",
	},
	{
		icon: PenLine,
		label: "Record Goal Note",
		name: "record_goal_knowledge_note",
		description:
			"Persist a Pi decision or lifecycle note into the goal's knowledge overlay.",
	},
];

const PI_WORKSPACE_TOOLS: ToolDef[] = [
	{
		icon: LayoutList,
		label: "List Workspaces",
		name: "list_project_workspaces",
		description:
			"Inventory all non-archived workspaces in the project: goal, child, Claude, and Codex.",
	},
	{
		icon: GitMerge,
		label: "Inspect Merge State",
		name: "inspect_workspace_merge_state",
		description:
			"Check PR/MR status, git state, and landing readiness for a child workspace.",
	},
	{
		icon: RefreshCw,
		label: "Refresh Change Request",
		name: "refresh_change_request",
		description:
			"Refresh and cache the current PR/MR metadata for a child workspace.",
	},
	{
		icon: GitBranch,
		label: "Sync Target Branch",
		name: "sync_workspace_target_branch",
		description:
			"Pull the workspace's target branch to prepare for conflict resolution.",
	},
	{
		icon: Upload,
		label: "Push Branch",
		name: "push_workspace_branch",
		description:
			"Push a child workspace branch to its remote after local commit work.",
	},
	{
		icon: GitMerge,
		label: "Merge Change Request",
		name: "merge_change_request",
		description:
			"Merge an open PR/MR through the configured forge (only when explicitly requested).",
	},
	{
		icon: CheckCircle2,
		label: "Check Landed",
		name: "check_workspace_landed",
		description:
			"Verify whether a child workspace branch has landed in the goal branch.",
	},
	{
		icon: CheckSquare2,
		label: "Mark Landed",
		name: "mark_workspace_landed",
		description:
			"Manually mark a workspace as landed after user or supervisor confirmation.",
	},
];

// ─── Sub-components ────────────────────────────────────────────────────────────

type ToolRowProps = ToolDef & { first?: boolean };

function ToolRow({
	icon: Icon,
	label,
	name,
	description,
	first,
}: ToolRowProps) {
	return (
		<div
			className={cn(
				"group flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-accent/30",
				!first && "border-t border-border/30",
			)}
		>
			<div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-muted/40 text-muted-foreground/70 transition-colors group-hover:bg-accent group-hover:text-foreground">
				<Icon className="size-2.5" strokeWidth={1.8} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline gap-1.5">
					<span className="text-[12px] font-medium leading-tight text-foreground">
						{label}
					</span>
					<code className="font-mono text-[9px] leading-none text-muted-foreground/55">
						{name}
					</code>
				</div>
				<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
					{description}
				</p>
			</div>
		</div>
	);
}

function ToolGroupHeader({ title }: { title: string }) {
	return (
		<div className="px-3 pb-1 pt-2.5">
			<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/55">
				{title}
			</span>
		</div>
	);
}

type SkillBadgeProps = {
	label: string;
	active: boolean;
};

function SkillBadge({ label, active }: SkillBadgeProps) {
	return (
		<div className="flex items-center gap-2">
			<div
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					active ? "bg-green-500" : "bg-muted-foreground/25",
				)}
			/>
			<span
				className={cn(
					"text-[12px]",
					active ? "text-foreground" : "text-muted-foreground/50",
				)}
			>
				{label}
			</span>
			<span
				className={cn(
					"ml-auto text-[10px] font-medium",
					active
						? "text-green-600 dark:text-green-400"
						: "text-muted-foreground/40",
				)}
			>
				{active ? "installed" : "not installed"}
			</span>
		</div>
	);
}

// ─── AgentToolsSection ─────────────────────────────────────────────────────────

type AgentToolsSectionProps = {
	isActive: boolean;
};

export function AgentToolsSection({ isActive }: AgentToolsSectionProps) {
	const skillsQuery = useQuery({
		queryKey: ["helmorSkillsStatus"],
		queryFn: getHelmorSkillsStatus,
		staleTime: 30_000,
	});

	const installMutation = useMutation({
		mutationFn: installHelmorSkills,
		onSuccess: () => {
			void skillsQuery.refetch();
		},
	});

	const skills = skillsQuery.data;

	return (
		<div
			role="tabpanel"
			id="inspector-panel-tools"
			aria-labelledby="inspector-tab-tools"
			className={cn("flex h-full flex-col bg-sidebar", !isActive && "hidden")}
		>
			<ScrollArea className="flex-1">
				{/* ── Pi Agent ──────────────────────────────────────────── */}
				<div className="border-b border-border/50 pb-2">
					<div className="flex items-center gap-2.5 px-3 pb-1 pt-3">
						<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
							<Bot className="size-3.5" strokeWidth={1.8} />
						</div>
						<div className="min-w-0">
							<div className="text-[12px] font-semibold leading-tight text-foreground">
								Pi Agent
							</div>
							<div className="text-[10px] leading-tight text-muted-foreground">
								Built-in tools · always available in Pi sessions
							</div>
						</div>
					</div>

					<ToolGroupHeader title="Knowledge" />
					<div>
						{PI_KNOWLEDGE_TOOLS.map((tool, i) => (
							<ToolRow key={tool.name} {...tool} first={i === 0} />
						))}
					</div>

					<ToolGroupHeader title="Workspace" />
					<div>
						{PI_WORKSPACE_TOOLS.map((tool, i) => (
							<ToolRow key={tool.name} {...tool} first={i === 0} />
						))}
					</div>
				</div>

				{/* ── Helmor Skills ──────────────────────────────────────── */}
				<div className="px-3 py-3">
					<div className="flex items-center gap-2.5 pb-3">
						<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
							<Puzzle className="size-3.5" strokeWidth={1.8} />
						</div>
						<div className="min-w-0">
							<div className="text-[12px] font-semibold leading-tight text-foreground">
								Helmor Skills
							</div>
							<div className="text-[10px] leading-tight text-muted-foreground">
								Global slash-command skills for Claude & Codex
							</div>
						</div>
					</div>

					{skillsQuery.isLoading ? (
						<div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
							<LoaderCircle className="size-3 animate-spin" />
							Checking installation…
						</div>
					) : (
						<div className="mb-3 space-y-2.5 rounded-md border border-border/40 bg-muted/20 px-3 py-2.5">
							<SkillBadge label="Claude" active={skills?.claude ?? false} />
							<SkillBadge label="Codex" active={skills?.codex ?? false} />
							<SkillBadge label="Agents" active={skills?.agents ?? false} />
						</div>
					)}

					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5 text-[11px] cursor-pointer"
						onClick={() => installMutation.mutate()}
						disabled={installMutation.isPending || skillsQuery.isLoading}
					>
						{installMutation.isPending ? (
							<LoaderCircle className="size-3 animate-spin" />
						) : (
							<Puzzle className="size-3" strokeWidth={1.8} />
						)}
						{skills?.installed ? "Reinstall Skills" : "Install Skills"}
					</Button>

					{installMutation.isError && (
						<p className="mt-2 text-[11px] text-destructive">
							Install failed — try again.
						</p>
					)}

					{installMutation.isSuccess && (
						<p className="mt-2 text-[11px] text-green-600 dark:text-green-400">
							Skills installed successfully.
						</p>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
