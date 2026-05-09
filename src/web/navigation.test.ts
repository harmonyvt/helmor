import { describe, expect, it } from "vitest";
import { formatHelmorWebRoute, parseHelmorWebRoute } from "./navigation";

describe("web navigation routes", () => {
	it("parses the root route", () => {
		expect(parseHelmorWebRoute({ pathname: "/", search: "" })).toEqual({
			workspaceId: null,
			sessionId: null,
			view: "conversation",
		});
	});

	it("parses workspace and session routes", () => {
		expect(
			parseHelmorWebRoute({
				pathname: "/workspaces/ws%2Fone/sessions/session%20one",
				search: "?view=editor",
			}),
		).toEqual({
			workspaceId: "ws/one",
			sessionId: "session one",
			view: "editor",
		});
	});

	it("falls back to root state for unsupported paths", () => {
		expect(
			parseHelmorWebRoute({
				pathname: "/repositories/repo-1",
				search: "?view=unknown",
			}),
		).toEqual({
			workspaceId: null,
			sessionId: null,
			view: "conversation",
		});
	});

	it("formats workspace and session routes", () => {
		expect(
			formatHelmorWebRoute({
				workspaceId: "ws/one",
				sessionId: "session one",
				view: "editor",
			}),
		).toBe("/workspaces/ws%2Fone/sessions/session%20one?view=editor");
	});
});
