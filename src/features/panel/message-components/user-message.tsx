import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText } from "lucide-react";
import { useMemo } from "react";
import {
	createFilePreviewLoader,
	InlineBadge,
} from "@/components/inline-badge";
import type { FileMentionPart, MessagePart } from "@/lib/api";
import { basename, isImageExtensionPath } from "@/lib/path-util";
import { useSettings } from "@/lib/settings";
import { CopyMessageButton } from "./copy-message";
import type { RenderedMessage } from "./shared";
import { isFileMentionPart, isTextPart } from "./shared";

// Attachments arrive as structured `file-mention` parts (see
// `splitTextWithFiles`). Do not regex-scan text parts for `@<path>` —
// it would truncate paths containing whitespace.

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
			isFileMentionPart(p) && isImageExtensionPath(p.path),
	);
	const otherParts = parts.filter(
		(p) =>
			!isFileMentionPart(p) ||
			!isImageExtensionPath((p as FileMentionPart).path),
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
									return <span key={index}>{part.text}</span>;
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
