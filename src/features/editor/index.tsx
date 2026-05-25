import { FileCode2, GitCompareArrows, X } from "lucide-react";
import {
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { TrafficLightSpacer } from "@/components/chrome/traffic-light-spacer";
import { Button } from "@/components/ui/button";
import { ShortcutDisplay } from "@/features/shortcuts/shortcut-display";
import type { CodeGraph } from "@/lib/api";
import {
	describeEditorPath,
	type EditorSessionState,
} from "@/lib/editor-session";
import type { FileViewerGraphContext } from "@/lib/monaco-runtime";
import { cn } from "@/lib/utils";
import { describeUnknownError } from "@/lib/workspace-helpers";
import { buildViewerGraphContext } from "./viewer-graph";

type WorkspaceEditorSurfaceProps = {
	editorSession: EditorSessionState;
	workspaceId?: string | null;
	workspaceRootPath?: string | null;
	onChangeSession: (session: EditorSessionState) => void;
	onExit: () => void;
	onError?: (description: string, title?: string) => void;
};

type SurfaceStatus =
	| { kind: "loading" }
	| { kind: "ready" }
	| { kind: "error"; message: string };

type MonacoRuntimeModule = typeof import("@/lib/monaco-runtime");
type FileController = Awaited<
	ReturnType<MonacoRuntimeModule["createFileEditor"]>
>;
type DiffController = Awaited<
	ReturnType<MonacoRuntimeModule["createDiffEditor"]>
>;
type FileViewerController = Awaited<
	ReturnType<MonacoRuntimeModule["createFileViewer"]>
>;
type ReviewTab = "diff" | "file";

export function WorkspaceEditorSurface({
	editorSession,
	workspaceId,
	workspaceRootPath,
	onChangeSession,
	onExit,
	onError,
}: WorkspaceEditorSurfaceProps) {
	const editorHostRef = useRef<HTMLDivElement>(null);
	const fileControllerRef = useRef<FileController | null>(null);
	const diffControllerRef = useRef<DiffController | null>(null);
	const viewerControllerRef = useRef<FileViewerController | null>(null);
	const changeSubscriptionRef = useRef<{ dispose(): void } | null>(null);
	const latestSessionRef = useRef(editorSession);
	const onChangeSessionRef = useRef(onChangeSession);
	const onErrorRef = useRef(onError);
	const applyValueRef = useRef(false);
	const buildRequestIdRef = useRef(0);
	const [surfaceStatus, setSurfaceStatus] = useState<SurfaceStatus>({
		kind: "ready",
	});
	const [reviewTab, setReviewTab] = useState<ReviewTab>("diff");
	const [codeGraph, setCodeGraph] = useState<CodeGraph | null>(null);
	latestSessionRef.current = editorSession;
	onChangeSessionRef.current = onChangeSession;
	onErrorRef.current = onError;

	const canRenderFile =
		editorSession.kind === "file" &&
		editorSession.originalText !== undefined &&
		editorSession.modifiedText !== undefined;
	const canRenderDiff =
		editorSession.kind === "diff" &&
		editorSession.originalText !== undefined &&
		editorSession.modifiedText !== undefined;
	const canRenderViewer =
		editorSession.kind === "diff" && editorSession.modifiedText !== undefined;
	const effectiveWorkspaceRootPath =
		editorSession.workspaceRootPath ?? workspaceRootPath;
	const closeLabel =
		editorSession.kind === "diff" ? "Close diff view" : "Close editor view";
	const viewerGraphContext: FileViewerGraphContext | null = useMemo(
		() => buildViewerGraphContext(codeGraph, editorSession.path),
		[codeGraph, editorSession.path],
	);

	useEffect(() => {
		setReviewTab("diff");
	}, [editorSession.kind, editorSession.path]);

	useEffect(() => {
		if (
			(editorSession.kind === "file" && canRenderFile) ||
			(editorSession.kind === "diff" && canRenderDiff)
		) {
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const api = await import("@/lib/api");
				const isDiff = editorSession.kind === "diff";
				const status = editorSession.fileStatus ?? "M";
				const origRef = editorSession.originalRef ?? "HEAD";
				const gitPath = effectiveWorkspaceRootPath
					? describeEditorPath(editorSession.path, effectiveWorkspaceRootPath)
					: editorSession.path;

				// Fetch original side (from git ref)
				const originalPromise =
					isDiff && status !== "A" && effectiveWorkspaceRootPath
						? api.readFileAtRef(effectiveWorkspaceRootPath, gitPath, origRef)
						: Promise.resolve(null);

				// Fetch modified side (from disk or git ref)
				const modifiedPromise = editorSession.modifiedRef
					? effectiveWorkspaceRootPath
						? api.readFileAtRef(
								effectiveWorkspaceRootPath,
								gitPath,
								editorSession.modifiedRef,
							)
						: Promise.resolve(null)
					: status !== "D"
						? api.readEditorFile(editorSession.path).then((r) => r.content)
						: Promise.resolve(null);

				const [original, modified] = await Promise.all([
					originalPromise,
					modifiedPromise,
				]);

				if (cancelled) {
					return;
				}

				onChangeSessionRef.current({
					...editorSession,
					originalText:
						editorSession.originalText ??
						(isDiff ? (original ?? "") : (modified ?? "")),
					modifiedText: editorSession.modifiedText ?? modified ?? "",
					dirty: Boolean(editorSession.dirty),
				});
			} catch (error) {
				if (cancelled) {
					return;
				}

				const message = describeUnknownError(
					error,
					"Unable to load the selected file.",
				);
				setSurfaceStatus({ kind: "error", message });
				onErrorRef.current?.(message, "File open failed");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [canRenderDiff, canRenderFile, editorSession, effectiveWorkspaceRootPath]);

	useEffect(() => {
		if (editorSession.kind !== "diff" || reviewTab !== "file" || !workspaceId) {
			setCodeGraph(null);
			return;
		}

		let cancelled = false;
		void import("@/lib/api")
			.then(({ getCodeGraph }) => getCodeGraph(workspaceId))
			.then((graph) => {
				if (!cancelled) {
					setCodeGraph(graph);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					console.warn("[file-viewer] failed to load code graph", error);
					setCodeGraph(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [editorSession.kind, reviewTab, workspaceId]);

	// Dispose editors on unmount (separate from the switching effect so the
	// fast-path can skip cleanup without leaking on unmount).
	useEffect(() => {
		return () => {
			disposeControllers({
				fileControllerRef,
				diffControllerRef,
				viewerControllerRef,
				changeSubscriptionRef,
			});
		};
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onExit();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onExit]);

	// useLayoutEffect: run model swap BEFORE browser paint to avoid flicker.
	// The fast path returns NO cleanup — we keep the editor instance alive across
	// path changes. Only the slow path (first creation / kind change) disposes.
	useLayoutEffect(() => {
		const host = editorHostRef.current;
		if (!host) {
			return;
		}

		// ── Fast path: reuse existing file editor on path change ──
		// Runs even when content isn't loaded yet — switchFile uses Monaco model cache.
		if (editorSession.kind === "file" && fileControllerRef.current) {
			const content = editorSession.modifiedText ?? editorSession.originalText;
			const switched = fileControllerRef.current.switchFile(
				editorSession.path,
				content,
				editorSession.line,
				editorSession.column,
			);

			if (switched) {
				// Sync parent state from cached model when content wasn't in state yet
				if (content === undefined) {
					const cachedContent = fileControllerRef.current.getValue();
					onChangeSessionRef.current({
						...latestSessionRef.current,
						originalText: cachedContent,
						modifiedText: cachedContent,
						dirty: false,
					});
				}

				changeSubscriptionRef.current?.dispose();
				changeSubscriptionRef.current = null;
				changeSubscriptionRef.current =
					fileControllerRef.current.onDidChangeModelContent((value) => {
						if (applyValueRef.current) {
							return;
						}
						const latest = latestSessionRef.current;
						const nextDirty = value !== (latest.originalText ?? "");
						if (
							value === latest.modifiedText &&
							nextDirty === Boolean(latest.dirty)
						) {
							return;
						}
						onChangeSessionRef.current({
							...latest,
							kind: "file",
							modifiedText: value,
							dirty: nextDirty,
						});
					});
			}

			// No cleanup — editor stays alive. Unmount cleanup handles disposal.
			return;
		}

		// ── Guard: need content for initial editor creation ──
		if (!canRenderFile && !canRenderDiff) {
			return;
		}

		// ── Slow path: first render or kind change ──
		const requestId = buildRequestIdRef.current + 1;
		buildRequestIdRef.current = requestId;
		let disposed = false;

		disposeControllers({
			fileControllerRef,
			diffControllerRef,
			viewerControllerRef,
			changeSubscriptionRef,
		});
		host.replaceChildren();

		if (editorSession.kind === "file") {
			void (async () => {
				try {
					const { createFileEditor } = await import("@/lib/monaco-runtime");
					const controller = await createFileEditor({
						container: host,
						path: editorSession.path,
						content:
							editorSession.modifiedText ?? editorSession.originalText ?? "",
						line: editorSession.line,
						column: editorSession.column,
					});

					if (disposed || requestId !== buildRequestIdRef.current) {
						controller.dispose();
						return;
					}

					fileControllerRef.current = controller;
					changeSubscriptionRef.current = controller.onDidChangeModelContent(
						(value) => {
							if (applyValueRef.current) {
								return;
							}
							const latest = latestSessionRef.current;
							const nextDirty = value !== (latest.originalText ?? "");
							if (
								value === latest.modifiedText &&
								nextDirty === Boolean(latest.dirty)
							) {
								return;
							}
							onChangeSessionRef.current({
								...latest,
								kind: "file",
								modifiedText: value,
								dirty: nextDirty,
							});
						},
					);
					setSurfaceStatus({ kind: "ready" });
				} catch (error) {
					const message = describeUnknownError(
						error,
						"Unable to start the editor.",
					);
					setSurfaceStatus({ kind: "error", message });
					onErrorRef.current?.(message, "Editor startup failed");
				}
			})();
		} else if (reviewTab === "file") {
			if (!canRenderViewer) {
				return;
			}

			void (async () => {
				try {
					const { createFileViewer } = await import("@/lib/monaco-runtime");
					const controller = await createFileViewer({
						container: host,
						path: editorSession.path,
						content: editorSession.modifiedText ?? "",
						graphContext: viewerGraphContext,
					});

					if (disposed || requestId !== buildRequestIdRef.current) {
						controller.dispose();
						return;
					}

					viewerControllerRef.current = controller;
					setSurfaceStatus({ kind: "ready" });
				} catch (error) {
					const message = describeUnknownError(
						error,
						"Unable to start the file viewer.",
					);
					setSurfaceStatus({ kind: "error", message });
					onErrorRef.current?.(message, "File viewer failed");
				}
			})();
		} else {
			if (!canRenderDiff) {
				return;
			}

			void (async () => {
				try {
					const { createDiffEditor } = await import("@/lib/monaco-runtime");
					const controller = await createDiffEditor({
						container: host,
						path: editorSession.path,
						originalText: editorSession.originalText ?? "",
						modifiedText: editorSession.modifiedText ?? "",
						inline: Boolean(editorSession.inline),
					});

					if (disposed || requestId !== buildRequestIdRef.current) {
						controller.dispose();
						return;
					}

					diffControllerRef.current = controller;
					setSurfaceStatus({ kind: "ready" });
				} catch (error) {
					const message = describeUnknownError(
						error,
						"Unable to start the review surface.",
					);
					setSurfaceStatus({ kind: "error", message });
					onErrorRef.current?.(message, "Review surface failed");
				}
			})();
		}

		return () => {
			// Only guard against stale async completions — do NOT dispose the
			// editor here.  The slow path's entry block already calls
			// disposeControllers before creating a new editor (handles kind
			// changes), and the separate unmount effect handles final cleanup.
			disposed = true;
		};
	}, [
		canRenderDiff,
		canRenderFile,
		canRenderViewer,
		editorSession.kind,
		editorSession.modifiedText,
		editorSession.path,
		reviewTab,
		viewerGraphContext,
	]);

	useEffect(() => {
		if (
			editorSession.kind !== "file" ||
			!fileControllerRef.current ||
			editorSession.modifiedText === undefined
		) {
			return;
		}

		applyValueRef.current = true;
		try {
			fileControllerRef.current.setValue(editorSession.modifiedText);
		} finally {
			applyValueRef.current = false;
		}
	}, [editorSession.kind, editorSession.modifiedText]);

	useEffect(() => {
		if (editorSession.kind !== "file" || !fileControllerRef.current) {
			return;
		}

		fileControllerRef.current.revealPosition(
			editorSession.line,
			editorSession.column,
		);
	}, [editorSession.column, editorSession.kind, editorSession.line]);

	useEffect(() => {
		if (
			editorSession.kind !== "diff" ||
			!diffControllerRef.current ||
			editorSession.originalText === undefined ||
			editorSession.modifiedText === undefined
		) {
			return;
		}

		diffControllerRef.current.setTexts({
			originalText: editorSession.originalText,
			modifiedText: editorSession.modifiedText,
			inline: Boolean(editorSession.inline),
		});
	}, [
		editorSession.inline,
		editorSession.kind,
		editorSession.modifiedText,
		editorSession.originalText,
	]);

	useEffect(() => {
		if (
			editorSession.kind !== "diff" ||
			reviewTab !== "file" ||
			!viewerControllerRef.current ||
			editorSession.modifiedText === undefined
		) {
			return;
		}

		viewerControllerRef.current.setContent({
			path: editorSession.path,
			content: editorSession.modifiedText,
			graphContext: viewerGraphContext,
		});
	}, [
		editorSession.kind,
		editorSession.modifiedText,
		editorSession.path,
		reviewTab,
		viewerGraphContext,
	]);

	return (
		<section
			aria-label="Workspace editor surface"
			data-focus-scope="editor"
			className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
		>
			<div
				className="flex h-9 items-center border-b border-border"
				data-tauri-drag-region
			>
				{/* Traffic-light inset. macOS: left; Windows / Linux: right. */}
				<TrafficLightSpacer side="left" width={86} />

				<div className="min-w-0 flex-1" data-tauri-drag-region />

				{editorSession.kind === "diff" && (
					<div className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/20 p-0.5">
						<ReviewTabButton
							active={reviewTab === "diff"}
							onClick={() => setReviewTab("diff")}
							icon={<GitCompareArrows className="size-3.5" />}
							label="Diff"
						/>
						<ReviewTabButton
							active={reviewTab === "file"}
							onClick={() => setReviewTab("file")}
							icon={<FileCode2 className="size-3.5" />}
							label="File"
						/>
					</div>
				)}

				<div className="min-w-0 flex-1" data-tauri-drag-region />

				<div className="flex shrink-0 items-center pr-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onExit}
						aria-label={closeLabel}
						className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
					>
						<ShortcutDisplay hotkey="Escape" />
						<X className="size-3.5" strokeWidth={1.8} />
					</Button>
				</div>
			</div>

			<div className="relative flex min-h-0 flex-1 bg-background">
				<div
					ref={editorHostRef}
					aria-label="Editor canvas"
					className="h-full min-h-0 flex-1"
				/>

				{surfaceStatus.kind === "error" && (
					<div className="absolute inset-0 flex items-center justify-center bg-background">
						<SurfaceMessage message={surfaceStatus.message} />
					</div>
				)}
			</div>
		</section>
	);
}

function ReviewTabButton({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"inline-flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
				active
					? "bg-background text-foreground shadow-sm"
					: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
			)}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

function SurfaceMessage({ message }: { message: string }) {
	return (
		<p className="text-[13px] leading-5 text-muted-foreground">{message}</p>
	);
}

function disposeControllers({
	fileControllerRef,
	diffControllerRef,
	viewerControllerRef,
	changeSubscriptionRef,
}: {
	fileControllerRef: MutableRefObject<FileController | null>;
	diffControllerRef: MutableRefObject<DiffController | null>;
	viewerControllerRef: MutableRefObject<FileViewerController | null>;
	changeSubscriptionRef: MutableRefObject<{ dispose(): void } | null>;
}) {
	changeSubscriptionRef.current?.dispose();
	changeSubscriptionRef.current = null;
	fileControllerRef.current?.dispose();
	fileControllerRef.current = null;
	diffControllerRef.current?.dispose();
	diffControllerRef.current = null;
	viewerControllerRef.current?.dispose();
	viewerControllerRef.current = null;
}
