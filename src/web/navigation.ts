export type HelmorWebView = "conversation" | "editor";

export interface HelmorWebRoute {
	workspaceId: string | null;
	sessionId: string | null;
	view: HelmorWebView;
}

type LocationLike = Pick<Location, "pathname" | "search">;

const DEFAULT_ROUTE: HelmorWebRoute = {
	workspaceId: null,
	sessionId: null,
	view: "conversation",
};

function safeDecode(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function normalizePathname(pathname: string): string[] {
	return pathname
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function parseView(search: string): HelmorWebView {
	const value = new URLSearchParams(search).get("view");
	return value === "editor" ? "editor" : "conversation";
}

export function parseHelmorWebRoute(location: LocationLike): HelmorWebRoute {
	const view = parseView(location.search);
	const segments = normalizePathname(location.pathname);

	if (segments.length === 0) {
		return { ...DEFAULT_ROUTE, view };
	}

	if (segments[0] !== "workspaces") {
		return { ...DEFAULT_ROUTE, view };
	}

	if (segments.length === 2) {
		const workspaceId = safeDecode(segments[1]);
		return workspaceId
			? { workspaceId, sessionId: null, view }
			: { ...DEFAULT_ROUTE, view };
	}

	if (segments.length === 4 && segments[2] === "sessions") {
		const workspaceId = safeDecode(segments[1]);
		const sessionId = safeDecode(segments[3]);
		return workspaceId && sessionId
			? { workspaceId, sessionId, view }
			: { ...DEFAULT_ROUTE, view };
	}

	return { ...DEFAULT_ROUTE, view };
}

export function formatHelmorWebRoute(route: HelmorWebRoute): string {
	let pathname = "/";
	if (route.workspaceId) {
		pathname = `/workspaces/${encodeURIComponent(route.workspaceId)}`;
		if (route.sessionId) {
			pathname += `/sessions/${encodeURIComponent(route.sessionId)}`;
		}
	}

	const params = new URLSearchParams();
	if (route.view === "editor") {
		params.set("view", "editor");
	}
	const search = params.toString();
	return search ? `${pathname}?${search}` : pathname;
}

export function pushHelmorWebRoute(route: HelmorWebRoute): void {
	const url = formatHelmorWebRoute(route);
	if (`${window.location.pathname}${window.location.search}` === url) return;
	window.history.pushState(null, "", url);
}

export function replaceHelmorWebRoute(route: HelmorWebRoute): void {
	const url = formatHelmorWebRoute(route);
	if (`${window.location.pathname}${window.location.search}` === url) return;
	window.history.replaceState(null, "", url);
}
