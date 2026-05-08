import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import * as React from "react";
import { WorkspaceConversationContainer } from "@/features/conversation";
import { workspaceDetailQueryOptions } from "@/lib/query-client";
import { MobileShellContext } from "@/shell/mobile-shell";

// ---------------------------------------------------------------------------
// Sub-components (defined inline — this is a thin shell file)
// ---------------------------------------------------------------------------

interface MobileThreadHeaderProps {
	workspaceId: string | null;
}

function MobileThreadHeader({ workspaceId }: MobileThreadHeaderProps) {
	const { navigateToTab } = React.useContext(MobileShellContext);

	const detailQuery = useQuery({
		...workspaceDetailQueryOptions(workspaceId ?? "__none__"),
		enabled: Boolean(workspaceId),
	});

	const workspaceName = detailQuery.data?.title ?? null;

	return (
		<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
			<button
				type="button"
				onClick={() => navigateToTab("workspaces")}
				className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
				aria-label="Back to workspaces"
			>
				<ChevronLeftIcon className="h-4 w-4" />
			</button>
			<span className="flex-1 truncate text-sm font-medium text-foreground">
				{workspaceName ?? "Workspace"}
			</span>
		</div>
	);
}

function EmptyThreadState() {
	return (
		<div className="flex flex-1 items-center justify-center p-8">
			<p className="text-center text-sm text-muted-foreground">
				Pick a workspace to see its conversation.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface MobileThreadViewProps {
	selectedWorkspaceId: string | null;
	selectedSessionId: string | null;
	onSessionSelect: (sessionId: string | null) => void;
}

export default function MobileThreadView({
	selectedWorkspaceId,
	selectedSessionId,
	onSessionSelect,
}: MobileThreadViewProps) {
	// WorkspaceConversationContainer distinguishes between the workspace/session
	// the user has *selected* and the one currently *displayed* (resolved). We
	// manage the displayed IDs locally so this thin shell owns the resolution
	// lifecycle without burdening the parent.
	const [displayedWorkspaceId, setDisplayedWorkspaceId] = React.useState<
		string | null
	>(selectedWorkspaceId);
	const [displayedSessionId, setDisplayedSessionId] = React.useState<
		string | null
	>(selectedSessionId);

	// Keep displayed workspace in sync when the selection changes from outside.
	React.useEffect(() => {
		setDisplayedWorkspaceId(selectedWorkspaceId);
	}, [selectedWorkspaceId]);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			<MobileThreadHeader workspaceId={selectedWorkspaceId} />
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				{selectedWorkspaceId ? (
					<WorkspaceConversationContainer
						selectedWorkspaceId={selectedWorkspaceId}
						displayedWorkspaceId={displayedWorkspaceId}
						selectedSessionId={selectedSessionId}
						displayedSessionId={displayedSessionId}
						onSelectSession={onSessionSelect}
						onResolveDisplayedSession={setDisplayedSessionId}
					/>
				) : (
					<EmptyThreadState />
				)}
			</div>
		</div>
	);
}
