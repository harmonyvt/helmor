/**
 * localStorage helpers for tracking provider-switch session relationships.
 *
 * When a user switches providers with "Bring history", the new session is
 * linked to the old (parent) session so the panel can display the full
 * conversation chain — parent messages + a visual divider + new messages.
 *
 * Storage is intentionally local-only: the relationship only matters for the
 * current device's UI and doesn't need to round-trip through the DB or Rust.
 */

import type { AgentProvider } from "@/lib/api";

const STORAGE_KEY = "helmor-provider-switch-parents";

export type ProviderSwitchParent = {
	parentSessionId: string;
	fromProvider: AgentProvider;
	toProvider: AgentProvider;
};

function readMap(): Record<string, ProviderSwitchParent> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Record<string, ProviderSwitchParent>;
	} catch {
		return {};
	}
}

function writeMap(map: Record<string, ProviderSwitchParent>): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		// Ignore storage errors (e.g. private browsing quota exceeded).
	}
}

export function storeProviderSwitchParent(
	newSessionId: string,
	parent: ProviderSwitchParent,
): void {
	const map = readMap();
	map[newSessionId] = parent;
	writeMap(map);
}

export function getProviderSwitchParent(
	sessionId: string,
): ProviderSwitchParent | null {
	const map = readMap();
	return map[sessionId] ?? null;
}
