import { Check, X } from "lucide-react";
import type { AgentStreamEvent } from "./api";

export type PendingInteraction = {
	id: string;
	kind: "permission" | "deferredTool" | "elicitation";
	title: string;
	description?: string | null;
	toolName?: string | null;
	toolInput?: Record<string, unknown> | null;
	url?: string | null;
};

type InteractionDockProps = {
	interactions: PendingInteraction[];
	onRespond: (interaction: PendingInteraction, approved: boolean) => void;
};

export function InteractionDock({
	interactions,
	onRespond,
}: InteractionDockProps) {
	if (interactions.length === 0) {
		return null;
	}

	return (
		<div className="interaction-dock">
			{interactions.map((interaction) => (
				<section className="interaction-card" key={interaction.id}>
					<div>
						<strong>{interaction.title}</strong>
						<p>
							{interaction.description ??
								interaction.toolName ??
								"Helmor is waiting for your response."}
						</p>
						{interaction.url ? <small>{interaction.url}</small> : null}
						{interaction.toolInput ? (
							<code>{previewJson(interaction.toolInput)}</code>
						) : null}
					</div>
					<div className="interaction-actions">
						<button
							type="button"
							className="deny"
							onClick={() => onRespond(interaction, false)}
						>
							<X />
							Deny
						</button>
						<button
							type="button"
							className="allow"
							onClick={() => onRespond(interaction, true)}
						>
							<Check />
							Allow
						</button>
					</div>
				</section>
			))}
		</div>
	);
}

export function buildPendingInteraction(
	event: AgentStreamEvent,
): PendingInteraction | null {
	if (event.kind === "permissionRequest") {
		const permissionId = stringField(event, "permissionId");
		if (!permissionId) return null;
		const toolName = stringField(event, "toolName");
		return {
			id: permissionId,
			kind: "permission",
			title: stringField(event, "title") ?? "Approve tool access",
			description: stringField(event, "description"),
			toolName,
			toolInput: objectField(event, "toolInput"),
		};
	}
	if (event.kind === "deferredToolUse") {
		const toolUseId = stringField(event, "toolUseId");
		if (!toolUseId) return null;
		const toolName = stringField(event, "toolName");
		return {
			id: toolUseId,
			kind: "deferredTool",
			title: `Resume ${toolName ?? "tool use"}`,
			description: "The agent paused before running this tool.",
			toolName,
			toolInput: objectField(event, "toolInput"),
		};
	}
	if (event.kind === "elicitationRequest") {
		const elicitationId = stringField(event, "elicitationId");
		if (!elicitationId) return null;
		return {
			id: elicitationId,
			kind: "elicitation",
			title: stringField(event, "serverName") ?? "Answer request",
			description:
				stringField(event, "message") ??
				"An MCP server needs a response before the turn can continue.",
			url: stringField(event, "url"),
		};
	}
	return null;
}

function stringField(source: Record<string, unknown>, key: string) {
	const value = source[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function objectField(source: Record<string, unknown>, key: string) {
	const value = source[key];
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function previewJson(value: Record<string, unknown>) {
	const raw = JSON.stringify(value, null, 2);
	return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
}
