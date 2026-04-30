import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, ImageIcon } from "lucide-react";
import { memo, useMemo } from "react";
import {
	createFilePreviewLoader,
	InlineBadge,
} from "@/components/inline-badge";
import type { FileMentionPart, MessagePart } from "@/lib/api";
import { basename } from "@/lib/path-util";
import { useSettings } from "@/lib/settings";
import { CopyMessageButton } from "./copy-message";
import type { RenderedMessage } from "./shared";
import { isFileMentionPart, isTextPart } from "./shared";

const USER_FILE_RE = /@(\/\S+)(?=\s|$)/gi;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)$/i;

type UserContentSegment =
	| { type: "text"; value: string }
	| { type: "image"; value: string }
	| { type: "file"; value: string };

function splitUserContent(text: string): UserContentSegment[] {
	const segments: UserContentSegment[] = [];
	let lastIndex = 0;
	for (const match of text.matchAll(USER_FILE_RE)) {
		const matchIndex = match.index ?? 0;
		const before = text.slice(lastIndex, matchIndex);
		if (before) {
			segments.push({ type: "text", value: before });
		}
		const filePath = match[1];
		segments.push({
			type: IMAGE_EXT_RE.test(filePath) ? "image" : "file",
			value: filePath,
		});
		lastIndex = matchIndex + match[0].length;
	}
	const after = text.slice(lastIndex);
	if (after) {
		segments.push({ type: "text", value: after });
	}
	return segments;
}

const UserTextInline = memo(function UserTextInline({
	text,
}: {
	text: string;
}) {
	const segments = useMemo(() => splitUserContent(text), [text]);
	if (
		!segments.some(
			(segment) => segment.type === "image" || segment.type === "file",
		)
	) {
		return <>{text}</>;
	}
	return (
		<>
			{segments.map((segment, index) => {
				if (segment.type === "image") {
					return (
						<BubbleImageBadge
							key={`${segment.value}-${index}`}
							path={segment.value}
						/>
					);
				}
				if (segment.type === "file") {
					return (
						<BubbleFileBadge
							key={`${segment.value}-${index}`}
							path={segment.value}
						/>
					);
				}
				return <span key={index}>{segment.value}</span>;
			})}
		</>
	);
});

function BubbleFileBadge({ path }: { path: string }) {
	const fileName = basename(path);
	const previewLoader = useMemo(() => createFilePreviewLoader(path), [path]);
	return (
		<InlineBadge
			nonSelectable={false}
			icon={
				<FileText
					className="size-3.5 shrink-0 text-muted-foreground"
					strokeWidth={1.8}
				/>
			}
			label={fileName}
			previewLoader={previewLoader}
		/>
	);
}

function BubbleImageBadge({ path }: { path: string }) {
	const fileName = basename(path);
	return (
		<InlineBadge
			nonSelectable={false}
			icon={
				<ImageIcon
					className="size-3.5 shrink-0 text-chart-3"
					strokeWidth={1.8}
				/>
			}
			label={fileName}
			preview={{ kind: "image", title: fileName, path }}
		/>
	);
}

function InlineUserImage({ path }: { path: string }) {
	const src = useMemo(() => {
		try {
			return convertFileSrc(path);
		} catch {
			return `asset://localhost${path}`;
		}
	}, [path]);
	return (
		<img
			src={src}
			alt=""
			className="max-h-[420px] max-w-full rounded-md border border-border/40"
		/>
	);
}

export function ChatUserMessage({ message }: { message: RenderedMessage }) {
	const parts = message.content as MessagePart[];
	const { settings } = useSettings();

	const imageMentions = parts.filter(
		(p): p is FileMentionPart =>
			isFileMentionPart(p) && IMAGE_EXT_RE.test(p.path),
	);
	const otherParts = parts.filter(
		(p) =>
			!isFileMentionPart(p) || !IMAGE_EXT_RE.test((p as FileMentionPart).path),
	);
	const hasTextContent = otherParts.some(
		(p) => isTextPart(p) && p.text.trim().length > 0,
	);
	const hasOtherFileMentions = otherParts.some(isFileMentionPart);

	return (
		<div
			data-message-id={message.id}
			data-message-role="user"
			className="group/user flex min-w-0 justify-end"
		>
			<div className="relative flex max-w-[75%] min-w-0 flex-col items-end gap-2 pb-5">
				{imageMentions.length > 0 && (
					<div className="flex w-full flex-col items-end gap-2">
						{imageMentions.map((part, index) => (
							<InlineUserImage key={`${part.path}-${index}`} path={part.path} />
						))}
					</div>
				)}
				{(hasTextContent || hasOtherFileMentions) && (
					<div
						className="conversation-body-text w-full overflow-hidden rounded-md bg-accent/55 px-3 py-2 leading-7"
						style={{ fontSize: `${settings.fontSize}px` }}
					>
						<p className="whitespace-pre-wrap break-words">
							{otherParts.map((part, index) => {
								if (isTextPart(part)) {
									return <UserTextInline key={index} text={part.text} />;
								}
								if (isFileMentionPart(part)) {
									return <BubbleFileBadge key={index} path={part.path} />;
								}
								return null;
							})}
						</p>
					</div>
				)}
				<div className="pointer-events-none absolute right-1 bottom-0 flex items-center justify-end opacity-0 group-hover/user:pointer-events-auto group-hover/user:opacity-100 group-focus-within/user:pointer-events-auto group-focus-within/user:opacity-100">
					<CopyMessageButton
						message={message}
						className="size-5 shrink-0 text-muted-foreground/28 hover:text-muted-foreground"
					/>
				</div>
			</div>
		</div>
	);
}
