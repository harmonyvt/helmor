import type { ITheme } from "@xterm/xterm";

export type TerminalRenderer = "xterm" | "libghostty";

const TERMINAL_COLOR_SUFFIXES = [
	"background",
	"foreground",
	"cursor",
	"selection",
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"bright-black",
	"bright-red",
	"bright-green",
	"bright-yellow",
	"bright-blue",
	"bright-magenta",
	"bright-cyan",
	"bright-white",
] as const;

const THEME_KEYS = [
	"background",
	"foreground",
	"cursor",
	"selectionBackground",
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const satisfies readonly (keyof ITheme)[];

type ThemeKey = (typeof THEME_KEYS)[number];

const THEME_KEY_BY_SUFFIX = {
	background: "background",
	foreground: "foreground",
	cursor: "cursor",
	selection: "selectionBackground",
	black: "black",
	red: "red",
	green: "green",
	yellow: "yellow",
	blue: "blue",
	magenta: "magenta",
	cyan: "cyan",
	white: "white",
	"bright-black": "brightBlack",
	"bright-red": "brightRed",
	"bright-green": "brightGreen",
	"bright-yellow": "brightYellow",
	"bright-blue": "brightBlue",
	"bright-magenta": "brightMagenta",
	"bright-cyan": "brightCyan",
	"bright-white": "brightWhite",
} as const satisfies Record<(typeof TERMINAL_COLOR_SUFFIXES)[number], ThemeKey>;

const LIBGHOSTTY_FALLBACK_THEME = {
	background: "rgb(250, 250, 250)",
	foreground: "rgb(0, 0, 0)",
	cursor: "rgb(0, 0, 0)",
	selectionBackground: "rgb(220, 220, 220)",
	black: "rgb(0, 0, 0)",
	red: "rgb(205, 49, 49)",
	green: "rgb(13, 188, 121)",
	yellow: "rgb(229, 229, 16)",
	blue: "rgb(36, 114, 200)",
	magenta: "rgb(188, 63, 188)",
	cyan: "rgb(17, 168, 205)",
	white: "rgb(229, 229, 229)",
	brightBlack: "rgb(102, 102, 102)",
	brightRed: "rgb(241, 76, 76)",
	brightGreen: "rgb(35, 209, 139)",
	brightYellow: "rgb(245, 245, 67)",
	brightBlue: "rgb(59, 142, 234)",
	brightMagenta: "rgb(214, 112, 214)",
	brightCyan: "rgb(41, 184, 219)",
	brightWhite: "rgb(255, 255, 255)",
} as const satisfies Required<Pick<ITheme, ThemeKey>>;

let colorProbe: HTMLDivElement | null = null;

function clampByte(value: number): number {
	return Math.round(Math.min(255, Math.max(0, value)));
}

function formatRgb(r: number, g: number, b: number): string {
	return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
}

function resolveCssVars(value: string, style: CSSStyleDeclaration): string {
	let resolved = value.trim();
	for (let i = 0; i < 8; i++) {
		const next = resolved.replace(
			/var\(\s*(--[-\w]+)(?:\s*,\s*([^)]+))?\s*\)/g,
			(_match, name: string, fallback: string | undefined) =>
				style.getPropertyValue(name).trim() || fallback?.trim() || "",
		);
		if (next === resolved) break;
		resolved = next.trim();
	}
	return resolved;
}

function parseHexColor(value: string): string | null {
	const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (!match) return null;
	const hex =
		match[1].length === 3
			? match[1]
					.split("")
					.map((char) => char + char)
					.join("")
			: match[1];
	return formatRgb(
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
	);
}

function parseRgbColor(value: string): string | null {
	const match = value.match(
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+%?)?\s*\)$/i,
	);
	if (!match) return null;
	return formatRgb(
		Number.parseFloat(match[1]),
		Number.parseFloat(match[2]),
		Number.parseFloat(match[3]),
	);
}

function parseOklchColor(value: string): string | null {
	const match = value.match(
		/^oklch\(\s*([-\d.]+%?)\s+([-\d.]+)\s+([-\d.]+)(?:deg)?(?:\s*\/\s*[-\d.]+%?)?\s*\)$/i,
	);
	if (!match) return null;

	const l = match[1].endsWith("%")
		? Number.parseFloat(match[1]) / 100
		: Number.parseFloat(match[1]);
	const c = Number.parseFloat(match[2]);
	const h = (Number.parseFloat(match[3]) * Math.PI) / 180;
	if (![l, c, h].every(Number.isFinite)) return null;

	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
	const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
	const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
	const lCube = lPrime ** 3;
	const mCube = mPrime ** 3;
	const sCube = sPrime ** 3;
	const linearR =
		4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
	const linearG =
		-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
	const linearB =
		-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;
	const toSrgb = (channel: number) =>
		channel <= 0.0031308
			? 12.92 * channel
			: 1.055 * channel ** (1 / 2.4) - 0.055;

	return formatRgb(
		toSrgb(linearR) * 255,
		toSrgb(linearG) * 255,
		toSrgb(linearB) * 255,
	);
}

function canonicalizeWithDom(value: string): string | null {
	if (typeof document === "undefined") return null;
	colorProbe ??= document.createElement("div");
	if (!colorProbe.isConnected) {
		colorProbe.style.position = "absolute";
		colorProbe.style.pointerEvents = "none";
		colorProbe.style.visibility = "hidden";
		(document.body ?? document.documentElement).appendChild(colorProbe);
	}
	colorProbe.style.color = "";
	colorProbe.style.color = value;
	if (!colorProbe.style.color) return null;
	const computed = getComputedStyle(colorProbe).color;
	return parseRgbColor(computed);
}

export function canonicalizeCssColor(
	value: string | undefined,
	style: CSSStyleDeclaration = getComputedStyle(document.documentElement),
	fallback = "rgb(0, 0, 0)",
): string {
	if (!value) return fallback;
	const resolved = resolveCssVars(value, style);
	return (
		parseHexColor(resolved) ??
		parseRgbColor(resolved) ??
		parseOklchColor(resolved) ??
		canonicalizeWithDom(resolved) ??
		fallback
	);
}

function resolveRawTerminalTheme(style: CSSStyleDeclaration): ITheme {
	const v = (suffix: (typeof TERMINAL_COLOR_SUFFIXES)[number]) =>
		style.getPropertyValue(`--terminal-${suffix}`).trim();

	const fg = style.getPropertyValue("--foreground").trim();
	const mix = (pct: number) =>
		`color-mix(in oklch, ${fg} ${pct}%, transparent)`;

	const theme: ITheme = {
		scrollbarSliderBackground: mix(18),
		scrollbarSliderHoverBackground: mix(30),
		scrollbarSliderActiveBackground: mix(40),
	};
	for (const suffix of TERMINAL_COLOR_SUFFIXES) {
		theme[THEME_KEY_BY_SUFFIX[suffix]] = v(suffix);
	}
	return theme;
}

function resolveLibghosttyTerminalTheme(style: CSSStyleDeclaration): ITheme {
	const raw = resolveRawTerminalTheme(style);
	const theme: ITheme = {};
	for (const key of THEME_KEYS) {
		theme[key] = canonicalizeCssColor(
			raw[key],
			style,
			LIBGHOSTTY_FALLBACK_THEME[key],
		);
	}
	return theme;
}

/** Read --terminal-* and --foreground CSS variables and build a terminal theme. */
export function resolveTerminalTheme(
	renderer: TerminalRenderer = "xterm",
): ITheme {
	const style = getComputedStyle(document.documentElement);
	if (renderer === "libghostty") return resolveLibghosttyTerminalTheme(style);
	return resolveRawTerminalTheme(style);
}

export function getTerminalThemeRevision(): string {
	if (typeof document === "undefined") return "";
	const style = getComputedStyle(document.documentElement);
	return [
		document.documentElement.className,
		...TERMINAL_COLOR_SUFFIXES.map((suffix) =>
			style.getPropertyValue(`--terminal-${suffix}`).trim(),
		),
	].join("|");
}
