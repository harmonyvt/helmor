import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MessageSquare, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import {
	workspaceDetailQueryOptions,
	workspaceSessionsQueryOptions,
} from "@/lib/query-client";
import { PrStatusBar } from "@/web/components/pr-status-bar";
import { InspectorSheet } from "@/web/shell/inspector-sheet";
import { WebHeader } from "@/web/shell/web-header";

interface WorkspaceChatPageProps {
	workspaceId: string | null;
	sessionId: string | null;
	onSessionSelect: (id: string | null) => void;
	onBack?: () => void;
	isTablet?: boolean;
}

export default function WorkspaceChatPage({
	workspaceId,
	sessionId,
	onSessionSelect,
	onBack,
	isTablet = false,
}: WorkspaceChatPageProps) {
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [wideMode, setWideMode] = useState(false);

	// Mirror props for displayed state (allows animation during transition)
	const [displayedWorkspaceId, setDisplayedWorkspaceId] = useState<
		string | null
	>(workspaceId);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		sessionId,
	);

	// Keep displayed ids in sync with props
	useEffect(() => {
		setDisplayedWorkspaceId(workspaceId);
	}, [workspaceId]);

	useEffect(() => {
		setDisplayedSessionId(sessionId);
	}, [sessionId]);

	// Detect wide mode via matchMedia
	useEffect(() => {
		const mq = window.matchMedia("(min-width: 900px)");
		setWideMode(mq.matches);
		const handler = (e: MediaQueryListEvent) => setWideMode(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	const { data: workspaceDetail } = useQuery({
		...workspaceDetailQueryOptions(workspaceId ?? "__none__"),
		enabled: !!workspaceId,
	});

	// Used by the auto-select effect below as a fallback when activeSessionId is absent.
	const { data: sessions = [] } = useQuery({
		...workspaceSessionsQueryOptions(workspaceId ?? "__none__"),
		enabled: !!workspaceId && !sessionId,
	});

	// Auto-select the workspace's active session (or first visible session) when
	// navigating to a workspace with no session already chosen.
	useEffect(() => {
		if (!workspaceId || sessionId) return;
		const targetId =
			workspaceDetail?.activeSessionId ??
			sessions.find((s) => !s.isHidden && !s.actionKind)?.id ??
			null;
		if (targetId) {
			onSessionSelect(targetId);
		}
	}, [
		workspaceId,
		sessionId,
		workspaceDetail?.activeSessionId,
		sessions,
		onSessionSelect,
	]);

	const workspaceName =
		workspaceDetail?.title ?? workspaceDetail?.directoryName ?? "Workspace";

	const handleResolveDisplayedSession = useCallback((id: string | null) => {
		setDisplayedSessionId(id);
	}, []);

	const headerLeft = (
		<>
			{onBack && !isTablet && (
				<button
					type="button"
					onClick={onBack}
					aria-label="Back to workspace list"
					className="cursor-pointer -ml-1 p-1 rounded hover:bg-muted transition-colors"
				>
					<ChevronLeft className="h-5 w-5 text-muted-foreground" />
				</button>
			)}
		</>
	);

	const headerRight = (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={() => setInspectorOpen((v) => !v)}
			className="cursor-pointer"
		>
			<PanelRightOpen className="h-4 w-4" />
			<span className="sr-only">Toggle inspector</span>
		</Button>
	);

	return (
		<div
			className="flex flex-col h-full overflow-hidden bg-background"
			style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
		>
			<WebHeader
				title={workspaceName}
				leftAction={headerLeft}
				rightActions={headerRight}
			/>

			{workspaceId && <PrStatusBar workspaceId={workspaceId} />}

			<div className="flex flex-1 min-h-0 overflow-hidden">
				<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
					{workspaceId ? (
						<WorkspaceConversationContainer
							selectedWorkspaceId={workspaceId}
							displayedWorkspaceId={displayedWorkspaceId}
							selectedSessionId={sessionId}
							displayedSessionId={displayedSessionId}
							onSelectSession={onSessionSelect}
							onResolveDisplayedSession={handleResolveDisplayedSession}
						/>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
							<MessageSquare className="h-8 w-8 opacity-40" />
							<p className="text-sm">Select a workspace to start</p>
						</div>
					)}
				</div>

				{wideMode && (
					<InspectorSheet
						open={inspectorOpen}
						onClose={() => setInspectorOpen(false)}
						workspaceId={workspaceId ?? ""}
						wideMode={true}
					/>
				)}
			</div>

			{!wideMode && (
				<InspectorSheet
					open={inspectorOpen}
					onClose={() => setInspectorOpen(false)}
					workspaceId={workspaceId ?? ""}
					wideMode={false}
				/>
			)}
		</div>
	);
}
