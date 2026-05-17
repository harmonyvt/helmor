import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	getCliStatus: vi.fn(),
	getHelmorSkillsStatus: vi.fn(),
	installCli: vi.fn(),
	installHelmorSkills: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getCliStatus: apiMocks.getCliStatus,
		getHelmorSkillsStatus: apiMocks.getHelmorSkillsStatus,
		installCli: apiMocks.installCli,
		installHelmorSkills: apiMocks.installHelmorSkills,
	};
});

import { CliInstallPanel } from "./cli-install";

describe("CliInstallPanel", () => {
	beforeEach(() => {
		apiMocks.getCliStatus.mockReset();
		apiMocks.getHelmorSkillsStatus.mockReset();
		apiMocks.installCli.mockReset();
		apiMocks.installHelmorSkills.mockReset();
		apiMocks.getHelmorSkillsStatus.mockResolvedValue({
			installed: true,
			claude: true,
			codex: true,
			agents: true,
			command: "helmor-dev skills export --target all",
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders the managed install state", async () => {
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor-dev",
			buildMode: "development",
			installState: "managed",
		});

		render(<CliInstallPanel />);

		await waitFor(() => {
			expect(screen.getByText(/Installed at/)).toBeInTheDocument();
		});
		expect(screen.getByText("helmor-dev")).toBeInTheDocument();
		expect(screen.getByText("/usr/local/bin/helmor-dev")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reinstall" }),
		).toBeInTheDocument();
	});

	it("renders the stale install state and allows reinstall", async () => {
		const user = userEvent.setup();
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor",
			buildMode: "release",
			installState: "stale",
		});
		apiMocks.installCli.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor",
			buildMode: "release",
			installState: "managed",
		});

		render(<CliInstallPanel />);

		await waitFor(() => {
			expect(
				screen.getByText(/is not managed by this app/i),
			).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Reinstall" }));

		await waitFor(() => {
			expect(apiMocks.installCli).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(screen.getByText(/Installed at/)).toBeInTheDocument();
		});
	});

	it("renders skills status and allows reinstalling bundled skills", async () => {
		const user = userEvent.setup();
		apiMocks.getCliStatus.mockResolvedValue({
			installed: true,
			installPath: "/usr/local/bin/helmor-dev",
			buildMode: "development",
			installState: "managed",
		});
		apiMocks.getHelmorSkillsStatus.mockResolvedValue({
			installed: false,
			claude: true,
			codex: false,
			agents: false,
			command: "helmor-dev skills export --target all",
		});
		apiMocks.installHelmorSkills.mockResolvedValue({
			installed: true,
			claude: true,
			codex: true,
			agents: true,
			command: "helmor-dev skills export --target all",
		});

		render(<CliInstallPanel />);

		await waitFor(() => {
			expect(screen.getByText("Agent Skills")).toBeInTheDocument();
		});
		expect(screen.getByText(/Codex missing/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Reinstall skills" }));

		await waitFor(() => {
			expect(apiMocks.installHelmorSkills).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(screen.getByText(/Codex installed/)).toBeInTheDocument();
		});
	});
});
