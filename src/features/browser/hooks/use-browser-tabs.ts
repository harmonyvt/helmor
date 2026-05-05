import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { browserToolTabId } from "@/features/browser-tabs/ids";
import { closeBrowserWebviewForTab } from "@/features/browser-tabs/runtime";
import {
	type BrowserTabRecord,
	closeBrowserTab,
	createBrowserTab,
	selectBrowserTab,
} from "@/lib/api";
import { workspaceBrowserTabsQueryOptions } from "@/lib/query-client";
import type { BrowserSessionState } from "../browser-session";

type UseBrowserTabsArgs = {
	workspaceId: string;
	session: BrowserSessionState;
	onChangeSession: (session: BrowserSessionState) => void;
};

export type UseBrowserTabsReturn = {
	tabs: BrowserTabRecord[];
	activeTabId: string | null;
	handleAddTab: () => void;
	handleSelectTab: (tabId: string) => void;
	handleCloseTab: (tabId: string) => void;
};

export function useBrowserTabs({
	workspaceId,
	session,
	onChangeSession,
}: UseBrowserTabsArgs): UseBrowserTabsReturn {
	const tabsQuery = useQuery({
		...workspaceBrowserTabsQueryOptions(workspaceId),
		enabled: !!workspaceId,
	});
	const tabs = tabsQuery.data ?? [];
	const { activeTabId } = session;

	// On first load, restore the DB-persisted active tab or pick the first one.
	const restoredRef = useRef(false);
	useEffect(() => {
		if (!tabsQuery.isFetched) return;
		if (restoredRef.current) return;
		restoredRef.current = true;
		if (activeTabId) return;
		const active = tabs.find((t) => t.active) ?? tabs[0];
		if (active) onChangeSession({ activeTabId: active.id });
	}, [tabsQuery.isFetched, tabs, activeTabId, onChangeSession]);

	const handleAddTab = useCallback(() => {
		void createBrowserTab(workspaceId).then((tab) => {
			onChangeSession({ activeTabId: tab.id });
		});
	}, [workspaceId, onChangeSession]);

	const handleSelectTab = useCallback(
		(tabId: string) => {
			onChangeSession({ activeTabId: tabId });
			void selectBrowserTab(tabId).catch(() => undefined);
		},
		[onChangeSession],
	);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			void closeBrowserWebviewForTab(tabId);
			if (activeTabId === tabId) {
				const idx = tabs.findIndex((t) => t.id === tabId);
				const fallback = tabs[idx + 1] ?? tabs[idx - 1] ?? null;
				onChangeSession({ activeTabId: fallback?.id ?? null });
				if (fallback) void selectBrowserTab(fallback.id).catch(() => undefined);
			}
			void closeBrowserTab(tabId);
		},
		[activeTabId, tabs, onChangeSession],
	);

	return { tabs, activeTabId, handleAddTab, handleSelectTab, handleCloseTab };
}

export { browserToolTabId };
