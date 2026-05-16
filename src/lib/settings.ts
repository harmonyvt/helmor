import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

export type ThemeMode = "system" | "light" | "dark";

/** Behavior when submitting a message while the agent is still responding.
 *  - `steer`: inject into the active turn (provider-native mid-turn steer).
 *  - `queue`: stash locally; auto-fire as a new turn once the agent finishes.
 */
export type FollowUpBehavior = "steer" | "queue";

export type ShortcutOverrides = Record<string, string | null>;

export type ClaudeCustomProviderSettings = {
	builtinProviderApiKeys: Record<string, string>;
	customBaseUrl: string;
	customApiKey: string;
	customModels: string;
};

export type AppSettings = {
	fontSize: number;
	branchPrefixType: "github" | "custom" | "none";
	branchPrefixCustom: string;
	theme: ThemeMode;
	notifications: boolean;
	lastWorkspaceId: string | null;
	lastSessionId: string | null;
	defaultModelId: string | null;
	defaultEffort: string | null;
	defaultFastMode: boolean;
	/** Optional model override for PR comment Review all sessions. */
	prCommentReviewModelId: string | null;
	/** Pi model ids allowed for Goals handoffs. Empty means unrestricted. */
	piHandoffModelIds: string[];
	/** Allow Goals assignee handoffs to use every Pi provider instead of the default Anthropic/Codex subset. */
	allowAllGoalAssigneePiModels: boolean;
	/** Webview zoom factor. 1.0 = 100%. Range 0.5–2.0. */
	zoomLevel: number;
	followUpBehavior: FollowUpBehavior;
	/** Force the context-usage ring to always be visible. When false (the
	 *  default), the ring auto-hides until usage crosses
	 *  `CONTEXT_USAGE_AUTO_REVEAL_THRESHOLD`. */
	alwaysShowContextUsage: boolean;
	showUsageStats: boolean;
	onboardingCompleted: boolean;
	shortcuts: ShortcutOverrides;
	claudeCustomProviders: ClaudeCustomProviderSettings;
	/** Use the libghostty terminal rendering library instead of xterm.js.
	 *  Enables GPU-accelerated rendering and improved font shaping.
	 *  Requires a restart to take effect. */
	libghosttyEnabled: boolean;
	/** Model IDs the user has starred for quick access. */
	favoriteModelIds: string[];
	/** Open web links from forge action rows in Helmor's workspace browser. */
	openActionLinksInHelmorBrowser: boolean;
	/** Expose Debug ingest through an ngrok HTTPS tunnel when Debug mode is active. */
	debugIngestPublicForward: boolean;
	/** Optional reserved ngrok domain used for the Debug ingest tunnel. */
	debugIngestNgrokDomain: string;
};

/**
 * Percentage of the context window above which the ring auto-reveals
 * even when `alwaysShowContextUsage` is off. Picked to match the
 * settings copy ("…only shown when more than 70% is used").
 */
export const CONTEXT_USAGE_AUTO_REVEAL_THRESHOLD = 70;

export const DEFAULT_SETTINGS: AppSettings = {
	fontSize: 14,
	branchPrefixType: "github",
	branchPrefixCustom: "",
	theme: "system",
	notifications: true,
	lastWorkspaceId: null,
	lastSessionId: null,
	defaultModelId: null,
	defaultEffort: "high",
	defaultFastMode: false,
	prCommentReviewModelId: null,
	piHandoffModelIds: [],
	allowAllGoalAssigneePiModels: false,
	zoomLevel: 1.0,
	followUpBehavior: "steer",
	alwaysShowContextUsage: true,
	showUsageStats: true,
	onboardingCompleted: false,
	shortcuts: {},
	claudeCustomProviders: {
		builtinProviderApiKeys: {},
		customBaseUrl: "",
		customApiKey: "",
		customModels: "",
	},
	libghosttyEnabled: false,
	favoriteModelIds: [],
	openActionLinksInHelmorBrowser: false,
	debugIngestPublicForward: false,
	debugIngestNgrokDomain: "",
};

export const THEME_STORAGE_KEY = "helmor-theme";

// theme is stored in localStorage (sync read for flash-free boot), not SQLite
const SETTINGS_KEY_MAP: Record<Exclude<keyof AppSettings, "theme">, string> = {
	fontSize: "app.font_size",
	branchPrefixType: "branch_prefix_type",
	branchPrefixCustom: "branch_prefix_custom",
	notifications: "app.notifications",
	lastWorkspaceId: "app.last_workspace_id",
	lastSessionId: "app.last_session_id",
	defaultModelId: "app.default_model_id",
	defaultEffort: "app.default_effort",
	defaultFastMode: "app.default_fast_mode",
	prCommentReviewModelId: "app.pr_comment_review_model_id",
	piHandoffModelIds: "app.pi_handoff_model_ids",
	allowAllGoalAssigneePiModels: "app.allow_all_goal_assignee_pi_models",
	zoomLevel: "app.zoom_level",
	followUpBehavior: "app.follow_up_behavior",
	alwaysShowContextUsage: "app.always_show_context_usage",
	showUsageStats: "app.show_usage_stats",
	onboardingCompleted: "app.onboarding_completed",
	shortcuts: "app.shortcuts",
	claudeCustomProviders: "app.claude_custom_providers",
	libghosttyEnabled: "app.libghostty_enabled",
	favoriteModelIds: "app.favorite_model_ids",
	openActionLinksInHelmorBrowser: "app.open_action_links_in_helmor_browser",
	debugIngestPublicForward: "app.debug_ingest_public_forward",
	debugIngestNgrokDomain: "app.debug_ingest_ngrok_domain",
};

function parseShortcutOverrides(raw: string | undefined): ShortcutOverrides {
	if (!raw) return DEFAULT_SETTINGS.shortcuts;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return DEFAULT_SETTINGS.shortcuts;
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				([, value]) => typeof value === "string" || value === null,
			),
		) as ShortcutOverrides;
	} catch {
		return DEFAULT_SETTINGS.shortcuts;
	}
}

function parseStringArray(
	raw: string | undefined,
	fallback: string[],
): string[] {
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return fallback;
		return parsed.filter((item): item is string => typeof item === "string");
	} catch {
		return fallback;
	}
}

function parseClaudeCustomProviderSettings(
	raw: string | undefined,
): ClaudeCustomProviderSettings {
	if (!raw) return DEFAULT_SETTINGS.claudeCustomProviders;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const builtinProviderApiKeys =
			parsed.builtinProviderApiKeys &&
			typeof parsed.builtinProviderApiKeys === "object" &&
			!Array.isArray(parsed.builtinProviderApiKeys)
				? Object.fromEntries(
						Object.entries(parsed.builtinProviderApiKeys).filter(
							([, value]) => typeof value === "string",
						),
					)
				: {};
		return {
			builtinProviderApiKeys,
			customBaseUrl:
				typeof parsed.customBaseUrl === "string" ? parsed.customBaseUrl : "",
			customApiKey:
				typeof parsed.customApiKey === "string" ? parsed.customApiKey : "",
			customModels:
				typeof parsed.customModels === "string" ? parsed.customModels : "",
		};
	} catch {
		return DEFAULT_SETTINGS.claudeCustomProviders;
	}
}

export async function loadSettings(): Promise<AppSettings> {
	try {
		const raw = await invoke<Record<string, string>>("get_app_settings");
		const rawDefaultModelId = raw[SETTINGS_KEY_MAP.defaultModelId];
		return {
			fontSize: raw[SETTINGS_KEY_MAP.fontSize]
				? Number(raw[SETTINGS_KEY_MAP.fontSize])
				: DEFAULT_SETTINGS.fontSize,
			branchPrefixType:
				(raw[
					SETTINGS_KEY_MAP.branchPrefixType
				] as AppSettings["branchPrefixType"]) ??
				DEFAULT_SETTINGS.branchPrefixType,
			branchPrefixCustom:
				raw[SETTINGS_KEY_MAP.branchPrefixCustom] ??
				DEFAULT_SETTINGS.branchPrefixCustom,
			theme:
				(localStorage.getItem(THEME_STORAGE_KEY) as AppSettings["theme"]) ??
				DEFAULT_SETTINGS.theme,
			notifications:
				raw[SETTINGS_KEY_MAP.notifications] !== undefined
					? raw[SETTINGS_KEY_MAP.notifications] === "true"
					: DEFAULT_SETTINGS.notifications,
			lastWorkspaceId: raw[SETTINGS_KEY_MAP.lastWorkspaceId] || null,
			lastSessionId: raw[SETTINGS_KEY_MAP.lastSessionId] || null,
			defaultModelId:
				rawDefaultModelId && rawDefaultModelId !== "default"
					? rawDefaultModelId
					: DEFAULT_SETTINGS.defaultModelId,
			defaultEffort:
				raw[SETTINGS_KEY_MAP.defaultEffort] || DEFAULT_SETTINGS.defaultEffort,
			defaultFastMode:
				raw[SETTINGS_KEY_MAP.defaultFastMode] !== undefined
					? raw[SETTINGS_KEY_MAP.defaultFastMode] === "true"
					: DEFAULT_SETTINGS.defaultFastMode,
			prCommentReviewModelId:
				raw[SETTINGS_KEY_MAP.prCommentReviewModelId] ||
				DEFAULT_SETTINGS.prCommentReviewModelId,
			piHandoffModelIds: parseStringArray(
				raw[SETTINGS_KEY_MAP.piHandoffModelIds],
				DEFAULT_SETTINGS.piHandoffModelIds,
			),
			allowAllGoalAssigneePiModels:
				raw[SETTINGS_KEY_MAP.allowAllGoalAssigneePiModels] !== undefined
					? raw[SETTINGS_KEY_MAP.allowAllGoalAssigneePiModels] === "true"
					: DEFAULT_SETTINGS.allowAllGoalAssigneePiModels,
			zoomLevel: raw[SETTINGS_KEY_MAP.zoomLevel]
				? Number(raw[SETTINGS_KEY_MAP.zoomLevel])
				: DEFAULT_SETTINGS.zoomLevel,
			followUpBehavior: (() => {
				const v = raw[SETTINGS_KEY_MAP.followUpBehavior];
				return v === "queue" || v === "steer"
					? v
					: DEFAULT_SETTINGS.followUpBehavior;
			})(),
			alwaysShowContextUsage:
				raw[SETTINGS_KEY_MAP.alwaysShowContextUsage] !== undefined
					? raw[SETTINGS_KEY_MAP.alwaysShowContextUsage] === "true"
					: DEFAULT_SETTINGS.alwaysShowContextUsage,
			showUsageStats:
				raw[SETTINGS_KEY_MAP.showUsageStats] !== undefined
					? raw[SETTINGS_KEY_MAP.showUsageStats] === "true"
					: DEFAULT_SETTINGS.showUsageStats,
			onboardingCompleted:
				raw[SETTINGS_KEY_MAP.onboardingCompleted] !== undefined
					? raw[SETTINGS_KEY_MAP.onboardingCompleted] === "true"
					: DEFAULT_SETTINGS.onboardingCompleted,
			shortcuts: parseShortcutOverrides(raw[SETTINGS_KEY_MAP.shortcuts]),
			claudeCustomProviders: parseClaudeCustomProviderSettings(
				raw[SETTINGS_KEY_MAP.claudeCustomProviders],
			),
			libghosttyEnabled:
				raw[SETTINGS_KEY_MAP.libghosttyEnabled] !== undefined
					? raw[SETTINGS_KEY_MAP.libghosttyEnabled] === "true"
					: DEFAULT_SETTINGS.libghosttyEnabled,
			favoriteModelIds: parseStringArray(
				raw[SETTINGS_KEY_MAP.favoriteModelIds],
				DEFAULT_SETTINGS.favoriteModelIds,
			),
			openActionLinksInHelmorBrowser:
				raw[SETTINGS_KEY_MAP.openActionLinksInHelmorBrowser] !== undefined
					? raw[SETTINGS_KEY_MAP.openActionLinksInHelmorBrowser] === "true"
					: DEFAULT_SETTINGS.openActionLinksInHelmorBrowser,
			debugIngestPublicForward:
				raw[SETTINGS_KEY_MAP.debugIngestPublicForward] !== undefined
					? raw[SETTINGS_KEY_MAP.debugIngestPublicForward] === "true"
					: DEFAULT_SETTINGS.debugIngestPublicForward,
			debugIngestNgrokDomain:
				raw[SETTINGS_KEY_MAP.debugIngestNgrokDomain] ??
				DEFAULT_SETTINGS.debugIngestNgrokDomain,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
	if (patch.theme !== undefined) {
		try {
			localStorage.setItem(THEME_STORAGE_KEY, patch.theme);
		} catch (error) {
			console.error(
				`[helmor] theme save failed for "${THEME_STORAGE_KEY}"`,
				error,
			);
		}
	}

	const settings: Record<string, string> = {};
	for (const [key, dbKey] of Object.entries(SETTINGS_KEY_MAP)) {
		const value = patch[key as keyof Omit<AppSettings, "theme">];
		if (value !== undefined) {
			settings[dbKey] =
				key === "shortcuts" ||
				key === "claudeCustomProviders" ||
				key === "favoriteModelIds" ||
				key === "piHandoffModelIds"
					? JSON.stringify(value)
					: value === null
						? ""
						: String(value);
		}
	}
	if (Object.keys(settings).length === 0) return;
	try {
		await invoke("update_app_settings", { settingsMap: settings });
	} catch {
		// ignore — non-Tauri env
	}
}

export type SettingsContextValue = {
	settings: AppSettings;
	/** False while the initial load from SQLite is still in flight. */
	isLoaded: boolean;
	updateSettings: (patch: Partial<AppSettings>) => void | Promise<void>;
};

export const SettingsContext = createContext<SettingsContextValue>({
	settings: DEFAULT_SETTINGS,
	isLoaded: false,
	updateSettings: async () => {},
});

export function useSettings(): SettingsContextValue {
	return useContext(SettingsContext);
}

/** Resolve the effective theme ("light" | "dark") from a ThemeMode setting. */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
	if (mode === "system") {
		if (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function"
		) {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return "dark";
	}
	return mode;
}
