import { afterEach, describe, expect, it } from "vitest";
import {
	canonicalizeCssColor,
	getTerminalThemeRevision,
	resolveTerminalTheme,
} from "./terminal-theme";

const terminalVars: Record<string, string> = {
	"--foreground": "rgb(1, 2, 3)",
	"--sidebar": "rgb(250, 250, 250)",
	"--terminal-background": "var(--sidebar)",
	"--terminal-foreground": "var(--foreground)",
	"--terminal-cursor": "var(--foreground)",
	"--terminal-selection": "rgb(220, 225, 235)",
	"--terminal-black": "rgb(0, 0, 0)",
	"--terminal-red": "rgb(205, 49, 49)",
	"--terminal-green": "rgb(13, 188, 121)",
	"--terminal-yellow": "rgb(229, 229, 16)",
	"--terminal-blue": "rgb(36, 114, 200)",
	"--terminal-magenta": "rgb(188, 63, 188)",
	"--terminal-cyan": "rgb(17, 168, 205)",
	"--terminal-white": "rgb(229, 229, 229)",
	"--terminal-bright-black": "rgb(102, 102, 102)",
	"--terminal-bright-red": "rgb(241, 76, 76)",
	"--terminal-bright-green": "rgb(35, 209, 139)",
	"--terminal-bright-yellow": "rgb(245, 245, 67)",
	"--terminal-bright-blue": "rgb(59, 142, 234)",
	"--terminal-bright-magenta": "rgb(214, 112, 214)",
	"--terminal-bright-cyan": "rgb(41, 184, 219)",
	"--terminal-bright-white": "rgb(255, 255, 255)",
};

function applyTerminalVars(overrides: Record<string, string> = {}) {
	for (const [name, value] of Object.entries({
		...terminalVars,
		...overrides,
	})) {
		document.documentElement.style.setProperty(name, value);
	}
}

describe("terminal theme resolution", () => {
	afterEach(() => {
		document.documentElement.removeAttribute("class");
		document.documentElement.removeAttribute("style");
		document.head.innerHTML = "";
	});

	it("keeps CSS token values for xterm", () => {
		applyTerminalVars();

		const theme = resolveTerminalTheme("xterm");

		expect(theme.background).toBe("var(--sidebar)");
		expect(theme.foreground).toBe("var(--foreground)");
		expect(theme.scrollbarSliderBackground).toBe(
			"color-mix(in oklch, rgb(1, 2, 3) 18%, transparent)",
		);
	});

	it("canonicalizes CSS variables to rgb values for libghostty", () => {
		applyTerminalVars();

		const theme = resolveTerminalTheme("libghostty");

		expect(theme.background).toBe("rgb(250, 250, 250)");
		expect(theme.foreground).toBe("rgb(1, 2, 3)");
		expect(theme.cursor).toBe("rgb(1, 2, 3)");
		expect(theme.red).toBe("rgb(205, 49, 49)");
		expect(theme.scrollbarSliderBackground).toBeUndefined();
	});

	it("canonicalizes oklch palette values for libghostty", () => {
		applyTerminalVars({
			"--terminal-black": "oklch(0 0 0)",
			"--terminal-white": "oklch(1 0 0)",
			"--terminal-red": "oklch(0.577 0.245 27.325)",
		});

		const theme = resolveTerminalTheme("libghostty");

		expect(theme.black).toBe("rgb(0, 0, 0)");
		expect(theme.white).toBe("rgb(255, 255, 255)");
		expect(theme.red).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
		expect(theme.red).not.toContain("oklch");
	});

	it("tracks root theme class and resolved CSS variable changes", () => {
		const style = document.createElement("style");
		style.textContent = `
			:root {
				${Object.entries(terminalVars)
					.map(([name, value]) => `${name}: ${value};`)
					.join("\n")}
			}
			.dark {
				--sidebar: rgb(30, 30, 30);
				--foreground: rgb(245, 245, 245);
			}
		`;
		document.head.appendChild(style);

		expect(resolveTerminalTheme("libghostty").background).toBe(
			"rgb(250, 250, 250)",
		);
		const lightRevision = getTerminalThemeRevision();

		document.documentElement.classList.add("dark");

		expect(resolveTerminalTheme("libghostty").background).toBe(
			"rgb(30, 30, 30)",
		);
		expect(getTerminalThemeRevision()).not.toBe(lightRevision);
	});

	it("normalizes direct CSS color values without document variables", () => {
		expect(canonicalizeCssColor("#0f0")).toBe("rgb(0, 255, 0)");
		expect(canonicalizeCssColor("rgba(10, 20, 30, 0.4)")).toBe(
			"rgb(10, 20, 30)",
		);
	});
});
