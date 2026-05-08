import { type SimpleIcon, siGithub, siGitlab } from "simple-icons";
import { cn } from "@/lib/utils";

type BrandIconProps = {
	icon: SimpleIcon;
	size?: number;
	className?: string;
	/**
	 * Accessible name. Omit for decorative icons (default) — the SVG is
	 * then marked `aria-hidden` so it doesn't contaminate the parent
	 * element's accessible name (e.g. a button with adjacent text).
	 * Pass a string when the icon stands alone and needs a label.
	 */
	"aria-label"?: string;
};

/**
 * Thin SVG wrapper around a Simple Icons entry. Renders the brand's
 * official glyph using `currentColor` so callers can tint via Tailwind
 * `text-*` utilities — don't hard-code the brand `hex` unless the design
 * explicitly asks for the full-color wordmark.
 */
export function BrandIcon({
	icon,
	size = 16,
	className,
	"aria-label": ariaLabel,
}: BrandIconProps) {
	const accessibilityProps =
		ariaLabel !== undefined
			? ({ role: "img", "aria-label": ariaLabel } as const)
			: ({ "aria-hidden": true } as const);
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="currentColor"
			className={cn("block shrink-0 overflow-visible", className)}
			{...accessibilityProps}
		>
			<path d={icon.path} />
		</svg>
	);
}

/** GitHub brand glyph (Simple Icons). Uses `currentColor`. */
export function GithubBrandIcon(props: Omit<BrandIconProps, "icon">) {
	return <BrandIcon icon={siGithub} {...props} />;
}

/** GitLab brand glyph (Simple Icons). Uses `currentColor`. */
export function GitlabBrandIcon(props: Omit<BrandIconProps, "icon">) {
	return <BrandIcon icon={siGitlab} {...props} />;
}
