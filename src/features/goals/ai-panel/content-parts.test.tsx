import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContentParts } from "./content-parts";

afterEach(() => {
	cleanup();
});

describe("Goals AI panel content parts", () => {
	it("renders assignee reports with a collapsible full excerpt", async () => {
		render(
			<ContentParts
				parts={[
					{
						type: "text",
						id: "report-text",
						text: [
							"## Assignee Report Received",
							"",
							"Card: Capybara joke test 4",
							"Report type: completed",
							"",
							"Excerpt:",
							"## Completed",
							"",
							"Because it wanted a tidy towel first.",
							"",
							"Then it checked the spring temperature twice.",
							"",
							"It also wrote down the lane update, copied the branch name, and verified the assignee notes before wrapping up.",
							"",
							"Finally, it delivered the full *spa-cial* punchline after the preview boundary.",
							"",
							"Recommended supervisor action:",
							"Review this report.",
						].join("\n"),
					},
				]}
			/>,
		);

		expect(
			await screen.findByRole("heading", {
				name: "Assignee Report Received",
				level: 3,
			}),
		).toBeInTheDocument();
		expect(screen.getByText("Card:", { exact: false })).toBeInTheDocument();
		expect(
			screen.queryByText(/full spa-cial punchline/),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Show full excerpt" }));

		expect(
			await screen.findByRole("heading", { name: "Completed", level: 2 }),
		).toBeInTheDocument();
		expect(screen.getByText("spa-cial").tagName.toLowerCase()).toBe("em");
	});
});
