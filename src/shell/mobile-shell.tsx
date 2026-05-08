import * as React from "react";
import { MobileBottomNav } from "./mobile-bottom-nav";

export type MobileTab = "workspaces" | "thread" | "inspector";

export const MobileShellContext = React.createContext<{
	activeTab: MobileTab;
	navigateToTab: (tab: MobileTab) => void;
}>({ activeTab: "workspaces", navigateToTab: () => {} });

interface MobileShellProps {
	selectedWorkspaceId: string | null;
	selectedSessionId: string | null;
	onWorkspaceSelect: (workspaceId: string) => void;
	onSessionSelect: (sessionId: string | null) => void;
	workspacesView: React.ReactNode;
	threadView: React.ReactNode;
	inspectorView: React.ReactNode;
}

function getDefaultTab(selectedWorkspaceId: string | null): MobileTab {
	return selectedWorkspaceId !== null ? "thread" : "workspaces";
}

export default function MobileShell({
	selectedWorkspaceId,
	selectedSessionId: _selectedSessionId,
	onWorkspaceSelect: _onWorkspaceSelect,
	onSessionSelect: _onSessionSelect,
	workspacesView,
	threadView,
	inspectorView,
}: MobileShellProps) {
	const [activeTab, setActiveTab] = React.useState<MobileTab>(() =>
		getDefaultTab(selectedWorkspaceId),
	);

	const prevWorkspaceIdRef = React.useRef(selectedWorkspaceId);

	React.useEffect(() => {
		const prev = prevWorkspaceIdRef.current;
		prevWorkspaceIdRef.current = selectedWorkspaceId;

		if (prev === null && selectedWorkspaceId !== null) {
			setActiveTab("thread");
		}
	}, [selectedWorkspaceId]);

	const contextValue = React.useMemo(
		() => ({ activeTab, navigateToTab: setActiveTab }),
		[activeTab],
	);

	return (
		<MobileShellContext.Provider value={contextValue}>
			<div className="flex h-screen flex-col overflow-hidden bg-background">
				<div
					className="shrink-0 bg-background"
					style={{ paddingTop: "env(safe-area-inset-top)" }}
				/>
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					{activeTab === "workspaces" && workspacesView}
					{activeTab === "thread" && threadView}
					{activeTab === "inspector" && inspectorView}
				</div>
				<MobileBottomNav activeTab={activeTab} onTabChange={setActiveTab} />
			</div>
		</MobileShellContext.Provider>
	);
}

export { MobileBottomNav };
