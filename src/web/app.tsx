import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposerInsertProvider } from "@/lib/composer-insert-context";
import {
	archivedWorkspacesQueryOptions,
	createHelmorQueryClient,
	workspaceGroupsQueryOptions,
	workspaceSessionsQueryOptions,
} from "@/lib/query-client";
import { SendingSessionsProvider } from "@/lib/sending-sessions-context";
import {
	type AppSettings,
	DEFAULT_SETTINGS,
	loadSettings,
	SettingsContext,
	THEME_STORAGE_KEY,
	type ThemeMode,
} from "@/lib/settings";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";
import {
	parseHelmorWebRoute,
	pushHelmorWebRoute,
	replaceHelmorWebRoute,
} from "./navigation";
import WebShell from "./shell/web-shell";

const EMPTY_SENDING_SESSION_IDS: ReadonlySet<string> = new Set();

function WebAppInner() {
	const initialRoute = useMemo(() => parseHelmorWebRoute(window.location), []);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
		() => initialRoute.workspaceId,
	);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		() => initialRoute.sessionId,
	);
	const routeHadInitialTarget = Boolean(
		initialRoute.workspaceId || initialRoute.sessionId,
	);
	const groupsQuery = useQuery(workspaceGroupsQueryOptions());
	const archivedQuery = useQuery(archivedWorkspacesQueryOptions());
	const sessionsQuery = useQuery({
		...workspaceSessionsQueryOptions(selectedWorkspaceId ?? "__none__"),
		enabled: !!selectedWorkspaceId,
	});

	useEffect(() => {
		const handlePopState = () => {
			const route = parseHelmorWebRoute(window.location);
			setSelectedWorkspaceId(route.workspaceId);
			setSelectedSessionId(route.sessionId);
		};

		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	useEffect(() => {
		if (routeHadInitialTarget) return;
		let cancelled = false;

		void loadSettings().then((settings) => {
			if (cancelled || selectedWorkspaceId) return;
			if (!settings.lastWorkspaceId) return;
			setSelectedWorkspaceId(settings.lastWorkspaceId);
			setSelectedSessionId(settings.lastSessionId);
			replaceHelmorWebRoute({
				workspaceId: settings.lastWorkspaceId,
				sessionId: settings.lastSessionId,
				view: "conversation",
			});
		});

		return () => {
			cancelled = true;
		};
	}, [routeHadInitialTarget, selectedWorkspaceId]);

	useEffect(() => {
		if (!selectedWorkspaceId) return;
		if (!groupsQuery.isFetched || !archivedQuery.isFetched) return;

		const workspaceIds = new Set([
			...(groupsQuery.data ?? []).flatMap((group) =>
				group.rows.map((workspace) => workspace.id),
			),
			...(archivedQuery.data ?? []).map((workspace) => workspace.id),
		]);
		if (workspaceIds.has(selectedWorkspaceId)) return;

		setSelectedWorkspaceId(null);
		setSelectedSessionId(null);
		replaceHelmorWebRoute({
			workspaceId: null,
			sessionId: null,
			view: "conversation",
		});
	}, [
		archivedQuery.data,
		archivedQuery.isFetched,
		groupsQuery.data,
		groupsQuery.isFetched,
		selectedWorkspaceId,
	]);

	useEffect(() => {
		if (!selectedWorkspaceId || !selectedSessionId) return;
		if (sessionsQuery.isLoading) return;

		const sessionIds = new Set(
			(sessionsQuery.data ?? []).map((session) => session.id),
		);
		if (sessionIds.has(selectedSessionId)) return;

		setSelectedSessionId(null);
		replaceHelmorWebRoute({
			workspaceId: selectedWorkspaceId,
			sessionId: null,
			view: "conversation",
		});
	}, [
		selectedSessionId,
		selectedWorkspaceId,
		sessionsQuery.data,
		sessionsQuery.isLoading,
	]);

	// Reset the session when the user switches to a different workspace so the
	// chat page can auto-select the new workspace's active session.
	const handleWorkspaceSelect = useCallback((id: string) => {
		setSelectedWorkspaceId(id);
		setSelectedSessionId(null);
		pushHelmorWebRoute({
			workspaceId: id,
			sessionId: null,
			view: "conversation",
		});
	}, []);

	const handleSessionSelect = useCallback(
		(id: string | null, options?: { replace?: boolean }) => {
			setSelectedSessionId(id);
			const nextRoute = {
				workspaceId: selectedWorkspaceId,
				sessionId: id,
				view: "conversation",
			} as const;
			if (options?.replace) {
				replaceHelmorWebRoute(nextRoute);
			} else {
				pushHelmorWebRoute(nextRoute);
			}
		},
		[selectedWorkspaceId],
	);

	const handleBackToList = useCallback(() => {
		setSelectedWorkspaceId(null);
		setSelectedSessionId(null);
		pushHelmorWebRoute({
			workspaceId: null,
			sessionId: null,
			view: "conversation",
		});
	}, []);

	return (
		<TooltipProvider delayDuration={0}>
			<WorkspaceToastProvider value={() => {}}>
				<SendingSessionsProvider value={EMPTY_SENDING_SESSION_IDS}>
					<ComposerInsertProvider value={() => {}}>
						<WebShell
							selectedWorkspaceId={selectedWorkspaceId}
							selectedSessionId={selectedSessionId}
							onWorkspaceSelect={handleWorkspaceSelect}
							onSessionSelect={handleSessionSelect}
							onBackToList={handleBackToList}
						/>
					</ComposerInsertProvider>
				</SendingSessionsProvider>
			</WorkspaceToastProvider>
		</TooltipProvider>
	);
}

export default function WebApp() {
	const [queryClient] = useState(() => createHelmorQueryClient());

	// localStorage is not always available in browser security contexts (private
	// mode, "block all cookies" settings, etc.). The web companion doesn't need
	// query persistence — it's a desktop-only optimisation — so use a plain
	// QueryClientProvider instead of PersistQueryClientProvider to avoid crashing
	// the React tree when storage access is denied.
	const preloadSettings = useMemo<AppSettings>(() => {
		try {
			const t = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
			return { ...DEFAULT_SETTINGS, theme: t ?? DEFAULT_SETTINGS.theme };
		} catch {
			return DEFAULT_SETTINGS;
		}
	}, []);

	const settingsContextValue = useMemo(
		() => ({
			settings: preloadSettings,
			isLoaded: false,
			updateSettings: (_patch: Partial<AppSettings>) =>
				Promise.resolve(undefined),
		}),
		[preloadSettings],
	);

	return (
		<SettingsContext.Provider value={settingsContextValue}>
			<QueryClientProvider client={queryClient}>
				<WebAppInner />
			</QueryClientProvider>
		</SettingsContext.Provider>
	);
}
