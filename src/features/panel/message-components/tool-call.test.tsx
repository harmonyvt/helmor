import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantToolCall } from "./tool-call";

describe("AssistantToolCall apply_patch", () => {
	it("defaults multi-file edits to collapsed and suppresses generic patch text when expanded", () => {
		const { container } = render(
			<AssistantToolCall
				toolName="apply_patch"
				args={{
					changes: [
						{ path: "/src/request-parser.ts", diff: "+line one" },
						{ path: "/src/data_dir.rs", diff: "+line two" },
						{ path: "/src/App.tsx", diff: "+line three" },
					],
				}}
				result="Patch applied"
			/>,
		);

		// Default: collapsed.
		expect(screen.queryByText("request-parser.ts")).not.toBeInTheDocument();
		expect(screen.queryByText("data_dir.rs")).not.toBeInTheDocument();
		expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();

		const details = container.querySelector(
			"details",
		) as HTMLDetailsElement | null;
		expect(details).not.toBeNull();

		// Expand: file list appears, generic "Patch applied" stays suppressed.
		details!.open = true;
		fireEvent(details!, new Event("toggle"));

		expect(screen.queryByText("Patch applied")).not.toBeInTheDocument();
		expect(screen.getByText("request-parser.ts")).toBeInTheDocument();
		expect(screen.getByText("data_dir.rs")).toBeInTheDocument();
		expect(screen.getByText("App.tsx")).toBeInTheDocument();

		// Collapse again: file list disappears.
		details!.open = false;
		fireEvent(details!, new Event("toggle"));

		expect(screen.queryByText("request-parser.ts")).not.toBeInTheDocument();
		expect(screen.queryByText("data_dir.rs")).not.toBeInTheDocument();
		expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();
	});
});

describe("AssistantToolCall goal audit", () => {
	it("renders the exact assignee update from a Pi Goals tool result", () => {
		render(
			<AssistantToolCall
				toolName="send_assignee_message"
				args={{ cardId: "workspace-child", message: "Please continue" }}
				result={JSON.stringify({
					workspaceId: "workspace-child",
					message:
						"Supervisor update from Goals Pi (priority: high):\n\nPlease continue",
				})}
			/>,
		);

		expect(
			screen.getByText("Audit: sent assignee update to workspace-child"),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Supervisor update from Goals Pi \(priority: high\)/),
		).toBeInTheDocument();
	});
});

describe("AssistantToolCall default-collapsed", () => {
	it("keeps a streaming Read collapsed until the user opens it", () => {
		const { container } = render(
			<AssistantToolCall
				toolName="Read"
				args={{ file_path: "/src/App.tsx" }}
				streamingStatus="in_progress"
			/>,
		);

		const details = container.querySelector("details");
		expect(details).not.toBeNull();
		expect(details!.open).toBe(false);
	});

	it("keeps a finished Bash with output collapsed by default", () => {
		const { container } = render(
			<AssistantToolCall
				toolName="Bash"
				args={{ command: "ls -la" }}
				result={"total 8\ndrwxr-xr-x  3 user staff   96 Jan  1 00:00 .\n"}
			/>,
		);

		const details = container.querySelector("details");
		expect(details).not.toBeNull();
		expect(details!.open).toBe(false);
		// Output content should not be rendered until the user opens the details.
		expect(screen.queryByText(/drwxr-xr-x/)).not.toBeInTheDocument();
	});

	it("renders Pi read tools as normal file reads instead of generic MCP rows", () => {
		const { container } = render(
			<AssistantToolCall
				toolName="mcp__pi__read"
				args={{ path: "/workspace/src/App.tsx", limit: 20 }}
				result="content"
			/>,
		);
		const view = within(container);

		expect(view.getByText("Read 20 lines")).toBeInTheDocument();
		expect(view.getByText("App.tsx")).toBeInTheDocument();
		expect(view.queryByText("via pi")).not.toBeInTheDocument();
	});
});
