export type InspectorTabsUiState = {
	tabsOpen: boolean;
	activeTab: string;
};

export const DEFAULT_INSPECTOR_TABS_UI_STATE: InspectorTabsUiState = {
	tabsOpen: false,
	activeTab: "setup",
};

const stateByWorkspace = new Map<string, InspectorTabsUiState>();

function copyState(state: InspectorTabsUiState): InspectorTabsUiState {
	return { ...state };
}

export function getInspectorTabsUiState(
	workspaceId: string | null,
): InspectorTabsUiState {
	if (!workspaceId) return copyState(DEFAULT_INSPECTOR_TABS_UI_STATE);
	return copyState(
		stateByWorkspace.get(workspaceId) ?? DEFAULT_INSPECTOR_TABS_UI_STATE,
	);
}

export function updateInspectorTabsUiState(
	workspaceId: string | null,
	updater: (current: InspectorTabsUiState) => InspectorTabsUiState,
): InspectorTabsUiState {
	const current = getInspectorTabsUiState(workspaceId);
	const next = updater(current);
	if (workspaceId) {
		stateByWorkspace.set(workspaceId, copyState(next));
	}
	return next;
}

export function _resetTabsUiStateForTesting() {
	stateByWorkspace.clear();
}
