/**
 * Custom component overrides for streamdown.
 *
 * Replaces streamdown's built-in table rendering
 * with shadcn/ui styled components.
 *
 * Code highlighting is handled by the @streamdown/code plugin.
 *
 * @see https://streamdown.ai/docs/components
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import {
	type ComponentType,
	cloneElement,
	isValidElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
} from "react";
import { TableCopyDropdown, TableDownloadDropdown } from "streamdown";
import { CodeBlock, CodeBlockCopyButton } from "@/components/ai/code-block";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useFileLinkContext } from "@/features/panel/message-components/file-link-context";
import { isPathWithinRoot } from "@/lib/editor-session";
import { parseLocalFileLink } from "@/lib/local-file-link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/**
 * Table override for `components.table`.
 *
 * Wraps content in `data-streamdown="table-wrapper"` so streamdown's
 * `TableCopyDropdown` / `TableDownloadDropdown` can locate the `<table>`
 * via `.closest()` + `.querySelector()`.
 */
export function StreamdownTable({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div data-streamdown="table-wrapper" className="my-4 flex flex-col gap-1">
			<div className="flex items-center justify-end gap-1">
				<TableCopyDropdown />
				<TableDownloadDropdown />
			</div>
			<div className="overflow-hidden rounded-md border border-border/70">
				<Table className={cn("text-[0.9em]", className)}>{children}</Table>
			</div>
		</div>
	);
}

export function StreamdownTableHeader({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return <TableHeader className={className}>{children}</TableHeader>;
}

export function StreamdownTableBody({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return <TableBody className={className}>{children}</TableBody>;
}

export function StreamdownTableRow({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return <TableRow className={className}>{children}</TableRow>;
}

export function StreamdownTableHead({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<TableHead
			className={cn(
				"h-8 border-r border-border/60 bg-muted/35 text-[0.9em] font-semibold last:border-r-0",
				className,
			)}
		>
			{children}
		</TableHead>
	);
}

export function StreamdownTableCell({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	return (
		<TableCell
			className={cn(
				"border-r border-border/60 py-1.5 text-[0.9em] last:border-r-0",
				className,
			)}
		>
			{children}
		</TableCell>
	);
}

function childrenToText(children: ReactNode): string {
	if (typeof children === "string" || typeof children === "number") {
		return String(children);
	}
	if (Array.isArray(children)) {
		return children.map(childrenToText).join("");
	}
	if (isValidElement(children)) {
		const props = children.props as { children?: ReactNode };
		return childrenToText(props.children);
	}
	return "";
}

export function StreamdownPre({ children }: { children?: ReactNode }) {
	if (!isValidElement(children)) {
		return children;
	}

	const child = children as ReactElement<{
		children?: ReactNode;
		className?: string;
	}>;
	const className =
		typeof child.props.className === "string" ? child.props.className : "";
	const languageMatch = className.match(/language-([^\s]+)/);
	const language = languageMatch?.[1] ?? "";

	// Keep Streamdown's built-in Mermaid / special handling path intact.
	if (language.toLowerCase() === "mermaid") {
		return cloneElement(child as ReactElement<Record<string, unknown>>, {
			"data-block": "true",
		});
	}

	const code = childrenToText(child.props.children);
	return (
		<CodeBlock code={code} language={language}>
			<CodeBlockCopyButton />
		</CodeBlock>
	);
}

export function StreamdownAnchor({
	children,
	className,
	href,
	...props
}: {
	children?: ReactNode;
	className?: string;
	href?: string;
} & Record<string, unknown>) {
	const { openInEditor, workspaceRootPath } = useFileLinkContext();

	const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
		if (!href) {
			return;
		}

		// Let users keep standard browser-like affordances for selection and
		// modifier-assisted clicks; only hijack the default left click path.
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}

		const localTarget = parseLocalFileLink(href, workspaceRootPath);
		if (
			localTarget &&
			openInEditor &&
			isPathWithinRoot(localTarget.path, workspaceRootPath)
		) {
			event.preventDefault();
			openInEditor(localTarget.path, localTarget.line, localTarget.column);
			return;
		}

		event.preventDefault();
		try {
			await openUrl(href);
		} catch (error) {
			console.error("[StreamdownAnchor] Failed to open URL", href, error);
		}
	};

	return (
		<a
			{...(props as Omit<
				React.AnchorHTMLAttributes<HTMLAnchorElement>,
				"children" | "className" | "href"
			>)}
			href={href}
			className={className}
			onClick={handleClick}
			rel="noreferrer"
			target="_blank"
		>
			{children}
		</a>
	);
}

// ---------------------------------------------------------------------------
// Aggregated components map
// ---------------------------------------------------------------------------

export const streamdownComponents = {
	a: StreamdownAnchor,
	pre: StreamdownPre,
	table: StreamdownTable,
	thead: StreamdownTableHeader,
	tbody: StreamdownTableBody,
	tr: StreamdownTableRow,
	th: StreamdownTableHead,
	td: StreamdownTableCell,
} as Record<string, ComponentType<Record<string, unknown>>>;
