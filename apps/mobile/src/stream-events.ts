import type { Dispatch, SetStateAction } from "react";
import { type AgentStreamEvent, api, type ThreadMessage } from "./api";
import {
	buildPendingInteraction,
	type PendingInteraction,
} from "./interactions";

export function handleAgentEvent(
	streamEvent: AgentStreamEvent,
	callbacks: {
		refreshMessages: () => Promise<void>;
		setMessages: Dispatch<SetStateAction<ThreadMessage[]>>;
		setPendingInteractions: Dispatch<SetStateAction<PendingInteraction[]>>;
	},
) {
	if (streamEvent.kind === "update") {
		callbacks.setMessages(streamEvent.messages);
		return;
	}
	if (streamEvent.kind === "streamingPartial") {
		const partial = streamEvent.message;
		callbacks.setMessages((current) => {
			const withoutStreamingTail = current.filter(
				(message) => !message.streaming,
			);
			return [...withoutStreamingTail, partial];
		});
		return;
	}
	if (
		streamEvent.kind === "done" ||
		streamEvent.kind === "aborted" ||
		streamEvent.kind === "error"
	) {
		callbacks.setPendingInteractions([]);
		void callbacks.refreshMessages();
	}
	const interaction = buildPendingInteraction(streamEvent);
	if (interaction) {
		callbacks.setPendingInteractions((current) => {
			const withoutDuplicate = current.filter(
				(item) => item.id !== interaction.id,
			);
			return [...withoutDuplicate, interaction];
		});
	}
}

export async function respond(
	token: string,
	interaction: PendingInteraction,
	approved: boolean,
) {
	if (interaction.kind === "permission") {
		await api.respondInteraction(token, interaction.id, {
			kind: "permission",
			behavior: approved ? "allow" : "deny",
		});
	} else if (interaction.kind === "deferredTool") {
		await api.respondInteraction(token, interaction.id, {
			kind: "deferredTool",
			behavior: approved ? "allow" : "deny",
		});
	} else {
		await api.respondInteraction(token, interaction.id, {
			kind: "elicitation",
			action: approved ? "accept" : "decline",
			content: approved ? {} : null,
		});
	}
}
