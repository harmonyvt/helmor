import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useContext, useState } from "react";
import { WorkspaceConversationContainer } from "@/features/conversation";
import type { WorkspaceStatus } from "@/lib/api";
import { setGoalChildWorkspaceStatus } from "@/lib/api";
import {
	goalChildWorkspacesQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { MobileShellContext } from "@/shell/mobile-shell";
import MobileGoalFlowBoard from "./mobile-goal-flow-board";

interface MobileGoalViewProps {
	workspaceId: string;
	onSessionSelect: (sessionId: string | null) => void;
}

function MobileGoalHeader({
	goalTitle,
	prUrl,
	onBack,
}: {
	goalTitle: string;
	prUrl?: string | null;
	onBack: () => void;
}) {
	return (
		<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
			<button
				type="button"
				onClick={onBack}
				className="cursor-pointer rounded p-1 hover:bg-accent"
				aria-label="Back to workspaces"
			>
				<ArrowLeft className="size-4" />
			</button>
			<span className="flex-1 truncate text-sm font-semibold">{goalTitle}</span>
			{prUrl ? (
				<a
					href={prUrl}
					target="_blank"
					rel="noreferrer"
					className="cursor-pointer rounded p-1 hover:bg-accent"
					aria-label="Open PR"
				>
					<ExternalLink className="size-4 text-muted-foreground" />
				</a>
			) : null}
		</div>
	);
}

function MobileGoalChildHeader({
	childId,
	onBack,
}: {
	childId: string;
	onBack: () => void;
}) {
	const detailQuery = useQuery(workspaceDetailQueryOptions(childId));
	const title =
		detailQuery.data?.title ?? detailQuery.data?.branch ?? "Workspace";

	return (
		<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
			<button
				type="button"
				onClick={onBack}
				className="cursor-pointer rounded p-1 hover:bg-accent"
				aria-label="Back to goal board"
			>
				<ArrowLeft className="size-4" />
			</button>
			<span className="flex-1 truncate text-sm font-semibold">{title}</span>
		</div>
	);
}

export default function MobileGoalView({
	workspaceId,
	onSessionSelect,
}: MobileGoalViewProps) {
	const { navigateToTab } = useContext(MobileShellContext);
	const [drilldownChildId, setDrilldownChildId] = useState<string | null>(null);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		null,
	);

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(workspaceId));
	const workspace = detailQuery.data;
	const childWorkspaces = childQuery.data ?? [];

	const queryClient = useQueryClient();
	const moveMutation = useMutation({
		mutationFn: ({
			childId,
			status,
		}: {
			childId: string;
			status: WorkspaceStatus;
		}) => setGoalChildWorkspaceStatus(workspaceId, childId, status),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalChildWorkspaces(workspaceId),
			}),
	});

	// Drilldown view
	if (drilldownChildId) {
		return (
			<div className="flex h-full flex-col overflow-hidden bg-background">
				<MobileGoalChildHeader
					childId={drilldownChildId}
					onBack={() => {
						setDrilldownChildId(null);
						setDisplayedSessionId(null);
					}}
				/>
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					<WorkspaceConversationContainer
						selectedWorkspaceId={drilldownChildId}
						displayedWorkspaceId={drilldownChildId}
						selectedSessionId={null}
						displayedSessionId={displayedSessionId}
						onSelectSession={onSessionSelect}
						onResolveDisplayedSession={setDisplayedSessionId}
					/>
				</div>
			</div>
		);
	}

	// Goal board view
	const goalTitle = workspace?.goalTitle ?? workspace?.title ?? "Goal";

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			<MobileGoalHeader
				goalTitle={goalTitle}
				prUrl={workspace?.prUrl}
				onBack={() => navigateToTab("workspaces")}
			/>
			<MobileGoalFlowBoard
				workspaces={childWorkspaces}
				onOpenWorkspace={(childId) => {
					setDrilldownChildId(childId);
					setDisplayedSessionId(null);
				}}
				onMoveWorkspace={(ws, lane) =>
					moveMutation.mutate({ childId: ws.id, status: lane })
				}
			/>
		</div>
	);
}
