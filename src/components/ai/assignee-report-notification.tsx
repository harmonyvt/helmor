import { ChevronDown, ChevronRight } from "lucide-react";
import { Suspense, useState } from "react";
import { LazyStreamdown } from "@/components/streamdown-loader";

type AssigneeReportNotification = {
	title: string;
	fields: Array<{ label: string; value: string }>;
	excerpt: string;
	recommendedAction: string | null;
};

export function parseAssigneeReportNotification(
	text: string,
): AssigneeReportNotification | null {
	const lines = text.trim().replace(/\r\n/g, "\n").split("\n");
	const titleLine = lines[0]?.trim() ?? "";
	if (!titleLine.startsWith("## Assignee Report Received")) {
		return null;
	}

	const excerptIndex = lines.findIndex((line) => line.trim() === "Excerpt:");
	if (excerptIndex < 0) return null;

	const actionIndex = lines.findIndex(
		(line, index) =>
			index > excerptIndex && line.trim() === "Recommended supervisor action:",
	);
	const excerptLines = trimBlankLines(
		lines.slice(excerptIndex + 1, actionIndex >= 0 ? actionIndex : undefined),
	);
	const excerpt = excerptLines.join("\n").trim();
	if (!excerpt) return null;

	const metadataLines = trimBlankLines(lines.slice(1, excerptIndex));
	const fields = metadataLines.flatMap((line) => {
		const trimmed = line.trim();
		if (!trimmed) return [];
		const separatorIndex = trimmed.indexOf(":");
		if (separatorIndex < 0) {
			return [{ label: "Details", value: trimmed }];
		}
		return [
			{
				label: trimmed.slice(0, separatorIndex).trim(),
				value: trimmed.slice(separatorIndex + 1).trim(),
			},
		];
	});

	const recommendedAction =
		actionIndex >= 0
			? trimBlankLines(lines.slice(actionIndex + 1))
					.join("\n")
					.trim() || null
			: null;

	return {
		title: titleLine.replace(/^#+\s*/, "").trim(),
		fields,
		excerpt,
		recommendedAction,
	};
}

export function AssigneeReportNotificationBlock({ text }: { text: string }) {
	const notification = parseAssigneeReportNotification(text);
	const [excerptOpen, setExcerptOpen] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	if (!notification) return null;

	const cardField = notification.fields.find((f) => f.label === "Card");
	const reportTypeField = notification.fields.find(
		(f) => f.label === "Report type",
	);
	const reportedAtField = notification.fields.find(
		(f) => f.label === "Reported at",
	);
	const extraFields = notification.fields.filter(
		(f) => !["Card", "Report type", "Reported at"].includes(f.label),
	);

	const reportType = reportTypeField?.value;
	const formattedDate = reportedAtField?.value
		? formatReportDate(reportedAtField.value)
		: null;

	return (
		<div className="rounded-md border border-border/60 bg-background px-3 py-2.5 text-[12px] leading-relaxed text-foreground shadow-sm">
			{/* Title + status badge */}
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-[12px] font-semibold leading-snug">
					{notification.title}
				</h3>
				{reportType && <ReportTypeBadge type={reportType} />}
			</div>

			{/* Key info row */}
			<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] text-muted-foreground">
				{cardField && (
					<span className="font-medium text-foreground/80">
						{cardField.value}
					</span>
				)}
				{cardField && formattedDate && (
					<span className="text-muted-foreground/40">·</span>
				)}
				{formattedDate && <span>{formattedDate}</span>}
				{extraFields.length > 0 && (
					<>
						<span className="text-muted-foreground/40">·</span>
						<button
							type="button"
							className="cursor-pointer text-muted-foreground/60 underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
							onClick={() => setDetailsOpen((o) => !o)}
						>
							{detailsOpen ? "hide details" : "details"}
						</button>
					</>
				)}
			</div>

			{/* Collapsible extra fields (UUIDs etc.) */}
			{detailsOpen && extraFields.length > 0 && (
				<dl className="mt-1.5 space-y-0.5 rounded bg-muted/30 px-2 py-1.5">
					{extraFields.map((field) => (
						<div key={field.label} className="flex gap-1 text-[10.5px]">
							<dt className="shrink-0 text-muted-foreground">{field.label}:</dt>
							<dd className="min-w-0 break-all font-mono text-foreground/60">
								{field.value}
							</dd>
						</div>
					))}
				</dl>
			)}

			{/* Excerpt — inline, no separate accordion header */}
			<div className="mt-2 border-t border-border/40 pt-2">
				{excerptOpen ? (
					<>
						<MarkdownBlock text={notification.excerpt} />
						<button
							type="button"
							className="mt-1 cursor-pointer text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
							onClick={() => setExcerptOpen(false)}
						>
							<ChevronDown className="mr-0.5 inline size-3" />
							Collapse
						</button>
					</>
				) : (
					<button
						type="button"
						className="w-full cursor-pointer text-left"
						onClick={() => setExcerptOpen(true)}
					>
						<p className="line-clamp-2 whitespace-pre-wrap break-words text-[11.5px] text-muted-foreground">
							{previewText(notification.excerpt)}
						</p>
						<span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground">
							<ChevronRight className="size-3" />
							Show full excerpt
						</span>
					</button>
				)}
			</div>
		</div>
	);
}

function ReportTypeBadge({ type }: { type: string }) {
	const isCompleted = type === "completed";
	return (
		<span
			className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
				isCompleted
					? "bg-green-500/15 text-green-600 dark:text-green-400"
					: "bg-muted text-muted-foreground"
			}`}
		>
			{type}
		</span>
	);
}

function MarkdownBlock({ text }: { text: string }) {
	return (
		<div className="conversation-markdown assistant-markdown-scale max-w-none break-words text-[12px] leading-relaxed text-foreground">
			<Suspense
				fallback={
					<div className="conversation-streamdown whitespace-pre-wrap break-words">
						{text}
					</div>
				}
			>
				<LazyStreamdown className="conversation-streamdown" mode="static">
					{text}
				</LazyStreamdown>
			</Suspense>
		</div>
	);
}

function formatReportDate(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "UTC",
			timeZoneName: "short",
		});
	} catch {
		return iso;
	}
}

function previewText(text: string) {
	const compact = text.split(/\s+/).filter(Boolean).join(" ");
	return compact.length > 160
		? `${compact.slice(0, 160).trimEnd()}...`
		: compact;
}

function trimBlankLines(lines: string[]) {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start]?.trim()) start += 1;
	while (end > start && !lines[end - 1]?.trim()) end -= 1;
	return lines.slice(start, end);
}
