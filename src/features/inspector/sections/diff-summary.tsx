import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, LoaderCircle, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import { seedNewSessionInCache } from "@/features/panel/session-cache";
import type {
	AgentModelOption,
	WorkspaceDetail,
	WorkspaceSessionSummary,
} from "@/lib/api";
import { createSession, renameSession } from "@/lib/api";
import type { DiffOpenOptions, InspectorFileItem } from "@/lib/editor-session";
import {
	agentModelSectionsQueryOptions,
	helmorQueryKeys,
} from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
	buildDiffReviewPrompt,
	changeStatusForPath,
	groupChanges,
	resolvePreferredPiModelId,
} from "./diff-summary-model";
import { DiffSummaryPreview } from "./diff-summary-preview";

type DiffSummaryVariant = "inspector" | "fullWindow";

type DiffSummaryTabProps = {
	workspaceId: string | null;
	repoId: string | null;
	workspaceRootPath: string | null;
	workspaceBranch: string | null;
	workspaceTargetBranch: string | null;
	changes: InspectorFileItem[];
	/** Only relevant for `variant="inspector"`. Ignored in full-window mode. */
	isActive?: boolean;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	/** Render mode. Defaults to the inspector sidebar tab panel. */
	variant?: DiffSummaryVariant;
	/** Required for full-window variant — closes the surface. */
	onExit?: () => void;
};

/** Mirrors `WorkspaceConversationContainerProps["pendingPromptForSession"]`
 *  (non-null shape). Kept local to avoid widening the conversation surface,
 *  but the fields must stay in sync. */
type PendingDiffReview = {
	sessionId: string;
	prompt: string;
	modelId?: string | null;
	permissionMode?: string | null;
	forceQueue?: boolean;
};

const PI_REVIEW_SESSION_TITLE = "Pi diff review";

const piOnlyModelFilter = (model: AgentModelOption) => model.provider === "pi";

export function DiffSummaryTab({
	workspaceId,
	repoId,
	workspaceRootPath,
	workspaceBranch,
	workspaceTargetBranch,
	changes,
	isActive,
	onOpenEditorFile,
	variant = "inspector",
	onExit,
}: DiffSummaryTabProps) {
	const isFullWindow = variant === "fullWindow";
	const queryClient = useQueryClient();
	const { settings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const piModels = useMemo(
		() =>
			modelSectionsQuery.data?.find((section) => section.id === "pi")
				?.options ?? [],
		[modelSectionsQuery.data],
	);
	const preferredPiModelId = useMemo(
		() =>
			resolvePreferredPiModelId(
				piModels,
				settings.diffSummaryModelId,
				settings.favoriteModelIds,
			),
		[piModels, settings.diffSummaryModelId, settings.favoriteModelIds],
	);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		null,
	);
	const [pendingReview, setPendingReview] = useState<PendingDiffReview | null>(
		null,
	);
	const [isStarting, setIsStarting] = useState(false);

	// Reset the embedded Pi review surface when the user switches workspaces.
	// Otherwise the previous workspace's session keeps rendering against the
	// newly-selected workspace and the queued prompt would fire against the
	// wrong target.
	useEffect(() => {
		setSelectedSessionId(null);
		setDisplayedSessionId(null);
		setPendingReview(null);
		setIsStarting(false);
	}, [workspaceId]);

	const groups = useMemo(() => groupChanges(changes), [changes]);
	const totalInsertions = changes.reduce(
		(sum, item) => sum + item.insertions,
		0,
	);
	const totalDeletions = changes.reduce((sum, item) => sum + item.deletions, 0);
	const hasChanges = changes.length > 0;
	const canReview = Boolean(workspaceId && workspaceRootPath) && hasChanges;

	const handleOpenPath = useCallback(
		(path: string) => {
			onOpenEditorFile(path, {
				fileStatus: changeStatusForPath(changes, path),
				workspaceRootPath,
				workspaceId,
			});
		},
		[changes, onOpenEditorFile, workspaceId, workspaceRootPath],
	);

	// `WorkspaceConversationContainer.onOpenFileReference` may pass line/column
	// from Pi's response — accept them, drop them for now (no line jump yet).
	const handleOpenFileReference = useCallback(
		(path: string, _line?: number, _column?: number) => {
			handleOpenPath(path);
		},
		[handleOpenPath],
	);

	const handleBackToPreview = useCallback(() => {
		setSelectedSessionId(null);
		setDisplayedSessionId(null);
	}, []);

	const handleStartReview = useCallback(async () => {
		if (!workspaceId || !workspaceRootPath || isStarting) return;
		if (!hasChanges) return;
		setIsStarting(true);
		try {
			const { sessionId } = await createSession(workspaceId);
			seedNewSessionInCache({
				queryClient,
				workspaceId,
				sessionId,
				workspace:
					queryClient.getQueryData<WorkspaceDetail | null>(
						helmorQueryKeys.workspaceDetail(workspaceId),
					) ?? null,
				existingSessions:
					queryClient.getQueryData<WorkspaceSessionSummary[]>(
						helmorQueryKeys.workspaceSessions(workspaceId),
					) ?? [],
			});

			// Give the session a recognizable title so users can find it in the
			// workspace's session list later. Fire-and-forget — a failure here
			// shouldn't block the review.
			void renameSession(sessionId, PI_REVIEW_SESSION_TITLE).catch((error) => {
				console.warn("[diff-summary] failed to set session title", error);
			});

			const prompt = buildDiffReviewPrompt({
				workspaceRootPath,
				workspaceBranch,
				workspaceTargetBranch,
				changes,
			});
			setSelectedSessionId(sessionId);
			setDisplayedSessionId(sessionId);
			setPendingReview({
				sessionId,
				prompt,
				modelId: preferredPiModelId,
				permissionMode: "default",
				forceQueue: true,
			});
		} catch (error) {
			console.error("[diff-summary] failed to start Pi review", error);
			toast.error("Could not start Pi diff review.", {
				description: error instanceof Error ? error.message : "Unknown error.",
			});
		} finally {
			setIsStarting(false);
		}
	}, [
		changes,
		hasChanges,
		isStarting,
		preferredPiModelId,
		queryClient,
		workspaceBranch,
		workspaceId,
		workspaceRootPath,
		workspaceTargetBranch,
	]);

	// While the prompt is still queued (review hasn't started streaming yet)
	// guard against double-spawn from rapid clicks of the header action.
	const newReviewDisabled = !canReview || isStarting || pendingReview !== null;

	const containerProps = isFullWindow
		? ({
				className: "flex h-full min-h-0 flex-col bg-background",
			} as const)
		: ({
				id: "inspector-panel-diff-summary",
				role: "tabpanel" as const,
				"aria-labelledby": "inspector-tab-diff-summary",
				hidden: !isActive,
				className: cn("flex h-full flex-col bg-sidebar", !isActive && "hidden"),
			} as const);

	return (
		<div {...containerProps}>
			{isFullWindow && (
				<div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 bg-muted/15 px-3">
					<div className="flex items-center gap-2 text-[12px] text-foreground">
						<Sparkles className="size-3.5 text-primary" strokeWidth={1.8} />
						<span className="font-medium">Pi diff review</span>
						<span className="text-muted-foreground">
							{changes.length} file{changes.length === 1 ? "" : "s"}
						</span>
					</div>
					{onExit && (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground hover:text-foreground"
							onClick={onExit}
							aria-label="Close diff review"
							title="Close diff review (Esc)"
						>
							<X className="size-3.5" strokeWidth={1.8} />
						</Button>
					)}
				</div>
			)}
			{selectedSessionId ? (
				<WorkspaceConversationContainer
					selectedWorkspaceId={workspaceId}
					displayedWorkspaceId={workspaceId}
					selectedSessionId={selectedSessionId}
					displayedSessionId={displayedSessionId}
					repoId={repoId}
					onSelectSession={(sessionId) => {
						setSelectedSessionId(sessionId);
						setDisplayedSessionId(sessionId);
					}}
					onResolveDisplayedSession={(sessionId) => {
						setDisplayedSessionId(sessionId);
						setSelectedSessionId(sessionId);
					}}
					workspaceRootPath={workspaceRootPath}
					onOpenFileReference={handleOpenFileReference}
					modelFilter={piOnlyModelFilter}
					preferredDefaultModelId={preferredPiModelId}
					pendingPromptForSession={pendingReview}
					onPendingPromptConsumed={() => setPendingReview(null)}
					headerLeading={
						<button
							type="button"
							onClick={handleBackToPreview}
							className="flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
							aria-label="Back to diff preview"
						>
							<ChevronLeft className="size-3" strokeWidth={2} />
							Preview
						</button>
					}
					headerActions={
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 cursor-pointer gap-1.5 px-2 text-[11px]"
							onClick={handleStartReview}
							disabled={newReviewDisabled}
							aria-label="Start a new Pi diff review"
						>
							{isStarting ? (
								<LoaderCircle className="size-3 animate-spin" />
							) : (
								<Sparkles className="size-3" />
							)}
							New review
						</Button>
					}
					compact={!isFullWindow}
				/>
			) : (
				<DiffSummaryPreview
					changes={changes}
					groups={groups}
					canReview={canReview}
					isStarting={isStarting}
					totalInsertions={totalInsertions}
					totalDeletions={totalDeletions}
					onStartReview={handleStartReview}
					onOpenPath={handleOpenPath}
				/>
			)}
		</div>
	);
}
