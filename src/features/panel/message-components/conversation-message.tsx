import { memo, useEffect } from "react";
import { recordMessageRender } from "@/lib/dev-render-debug";
import { ChatAssistantMessage } from "./assistant-message";
import { ProviderSwitchDivider } from "./provider-switch-divider";
import type { RenderedMessage } from "./shared";
import { isProviderSwitchDividerPart } from "./shared";
import { ChatSystemMessage } from "./system-message";
import { ChatUserMessage } from "./user-message";

function ConversationMessage({
	message,
	previousAssistantMessage,
	sessionId,
	itemIndex,
	onFocusChild,
}: {
	message: RenderedMessage;
	previousAssistantMessage?: RenderedMessage | null;
	sessionId: string;
	itemIndex: number;
	onFocusChild?: (sessionId: string, parentSessionId?: string | null) => void;
}) {
	const messageKey = message.id ?? `${message.role}:${itemIndex}`;
	useEffect(() => {
		recordMessageRender(sessionId, messageKey);
	});

	const streaming = message.role === "assistant" && message.streaming === true;

	// Provider-switch divider: a synthetic system message injected between
	// the parent session's history and the new session's messages.
	if (
		message.role === "system" &&
		message.id === "__provider-switch-divider__"
	) {
		const dividerPart = message.content.find(isProviderSwitchDividerPart);
		if (dividerPart) {
			return <ProviderSwitchDivider part={dividerPart} />;
		}
	}

	if (message.role === "user") {
		return <ChatUserMessage message={message} />;
	}

	if (message.role === "assistant") {
		return (
			<ChatAssistantMessage
				message={message}
				streaming={streaming}
				onFocusChild={onFocusChild}
			/>
		);
	}

	return (
		<ChatSystemMessage
			message={message}
			previousAssistantMessage={previousAssistantMessage}
		/>
	);
}

export const MemoConversationMessage = memo(
	ConversationMessage,
	(prev, next) => {
		return (
			prev.message === next.message &&
			prev.previousAssistantMessage === next.previousAssistantMessage &&
			prev.sessionId === next.sessionId &&
			prev.itemIndex === next.itemIndex &&
			prev.onFocusChild === next.onFocusChild
		);
	},
);
