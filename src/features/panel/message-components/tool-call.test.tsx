import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CollapsedGroupPart } from "@/lib/api";
import { AssistantToolCall, CollapsedToolGroup } from "./tool-call";

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

		const audit = screen.getByText(
			/Sent to assignee · Supervisor update from Goals Pi \(priority: high\)/,
		);
		expect(audit).toBeInTheDocument();
		const details = audit.closest("details") as HTMLDetailsElement | null;
		expect(details).not.toBeNull();
		details!.open = true;
		fireEvent(details!, new Event("toggle"));
		expect(
			screen.getByText((_, element) => {
				return (
					element?.tagName.toLowerCase() === "pre" &&
					element.textContent?.includes(
						"Supervisor update from Goals Pi (priority: high):",
					) === true
				);
			}),
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

// Helper to build a minimal CollapsedGroupPart for tests.
function makeGroup(
	overrides: Partial<CollapsedGroupPart> = {},
): CollapsedGroupPart {
	return {
		type: "collapsed-group",
		id: "group:tc1",
		category: "read",
		summary: "Read 3 files",
		active: false,
		tools: [
			{
				type: "tool-call",
				toolCallId: "tc1",
				toolName: "Read",
				args: { file_path: "/src/App.tsx" },
				argsText: '{"file_path":"/src/App.tsx"}',
				result: "content",
				isError: false,
			},
			{
				type: "tool-call",
				toolCallId: "tc2",
				toolName: "Read",
				args: { file_path: "/src/main.tsx" },
				argsText: '{"file_path":"/src/main.tsx"}',
				result: "content",
				isError: false,
			},
			{
				type: "tool-call",
				toolCallId: "tc3",
				toolName: "Read",
				args: { file_path: "/src/lib/api.ts" },
				argsText: '{"file_path":"/src/lib/api.ts"}',
				result: "content",
				isError: false,
			},
		],
		...overrides,
	};
}

describe("CollapsedToolGroup", () => {
	// Count <details> elements nested inside the outer CollapsedToolGroup details.
	// When closed the inner tool rows are removed from the DOM entirely
	// (React conditional rendering, not CSS visibility), so this count is 0.
	// When open, each AssistantToolCall tool row contributes at least one <details>.
	function innerDetailsCount(container: HTMLElement): number {
		const outer = container.querySelector(
			"details",
		) as HTMLDetailsElement | null;
		return outer ? outer.querySelectorAll("details").length : 0;
	}

	it("renders summary and tool count when closed by default (completed group)", () => {
		render(<CollapsedToolGroup group={makeGroup()} />);

		// Summary text and count are always visible in the <summary> element.
		expect(screen.getByText("Read 3 files")).toBeInTheDocument();
		expect(screen.getByText("3 tools")).toBeInTheDocument();
	});

	it("does not render inner tool rows by default for a completed group", () => {
		const { container } = render(<CollapsedToolGroup group={makeGroup()} />);

		// Outer details element starts closed.
		const details = container.querySelector("details") as HTMLDetailsElement;
		expect(details).not.toBeNull();
		expect(details.open).toBe(false);

		// No inner tool-row <details> should be present in the DOM.
		expect(innerDetailsCount(container)).toBe(0);
	});

	it("reveals inner tool rows after opening the group", () => {
		const { container } = render(<CollapsedToolGroup group={makeGroup()} />);

		const details = container.querySelector("details") as HTMLDetailsElement;
		expect(details).not.toBeNull();

		// Simulate the browser toggling the details element open.
		details.open = true;
		fireEvent(details, new Event("toggle"));

		// Each tool renders its own <details> row (AssistantToolCall root element).
		expect(innerDetailsCount(container)).toBeGreaterThan(0);
	});

	it("starts open when group is active (streaming)", () => {
		const { container } = render(
			<CollapsedToolGroup group={makeGroup({ active: true, tools: [] })} />,
		);

		const details = container.querySelector("details") as HTMLDetailsElement;
		expect(details).not.toBeNull();
		expect(details.open).toBe(true);
	});

	it("collapses back after being opened then closed", () => {
		const { container } = render(<CollapsedToolGroup group={makeGroup()} />);

		const details = container.querySelector("details") as HTMLDetailsElement;

		// Open — inner tool rows appear.
		details.open = true;
		fireEvent(details, new Event("toggle"));
		expect(innerDetailsCount(container)).toBeGreaterThan(0);

		// Close — inner tool rows are removed from the DOM.
		details.open = false;
		fireEvent(details, new Event("toggle"));
		expect(innerDetailsCount(container)).toBe(0);
	});
});
