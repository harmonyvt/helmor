import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenericCard } from "./generic-card";

const basePart = {
	type: "generic-card" as const,
	id: "card-1",
	title: "Pi extension notification",
	provider: "pi",
};

describe("GenericCard", () => {
	it("renders title, body, metadata, and expandable details", () => {
		const { container } = render(
			<GenericCard
				part={{
					...basePart,
					subtitle: "demo-extension",
					body: "Custom UI is not available yet",
					severity: "warning",
					status: "blocked",
					details: { action: "custom" },
				}}
			/>,
		);

		expect(screen.getByText("Pi extension notification")).toBeInTheDocument();
		expect(screen.getByText("demo-extension")).toBeInTheDocument();
		expect(
			screen.getByText("Custom UI is not available yet"),
		).toBeInTheDocument();
		expect(screen.getByText("pi")).toBeInTheDocument();
		expect(screen.getByText("blocked")).toBeInTheDocument();
		expect(container.querySelector("details")).not.toBeNull();
		expect(screen.getByText(/"action": "custom"/)).toBeInTheDocument();
	});
});
