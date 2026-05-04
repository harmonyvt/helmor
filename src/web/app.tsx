import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposerInsertProvider } from "@/lib/composer-insert-context";
import { createHelmorQueryClient } from "@/lib/query-client";
import { SendingSessionsProvider } from "@/lib/sending-sessions-context";
import {
	type AppSettings,
	DEFAULT_SETTINGS,
	SettingsContext,
	THEME_STORAGE_KEY,
	type ThemeMode,
} from "@/lib/settings";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";
import WebShell from "./shell/web-shell";

const EMPTY_SENDING_SESSION_IDS: ReadonlySet<string> = new Set();

function WebAppInner() {
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
		null,
	);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null,
	);

	// Reset the session when the user switches to a different workspace so the
	// chat page can auto-select the new workspace's active session.
	const handleWorkspaceSelect = useCallback((id: string) => {
		setSelectedWorkspaceId(id);
		setSelectedSessionId(null);
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
							onSessionSelect={setSelectedSessionId}
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
