import { Send, Square } from "lucide-react";
import type { ThreadMessage, WorkspaceSession } from "./api";
import { InteractionDock, type PendingInteraction } from "./interactions";
import { renderParts } from "./message-parts";

type ThreadViewProps = {
	sessions: WorkspaceSession[];
	selectedSessionId?: string | null;
	messages: ThreadMessage[];
	prompt: string;
	sending: boolean;
	pendingInteractions: PendingInteraction[];
	onSelectSession: (session: WorkspaceSession) => void;
	onPromptChange: (value: string) => void;
	onSendPrompt: () => void;
	onStop: () => void;
	onRespondToInteraction: (
		interaction: PendingInteraction,
		approved: boolean,
	) => void;
};

export function ThreadView({
	sessions,
	selectedSessionId,
	messages,
	prompt,
	sending,
	pendingInteractions,
	onSelectSession,
	onPromptChange,
	onSendPrompt,
	onStop,
	onRespondToInteraction,
}: ThreadViewProps) {
	return (
		<section className="thread-view">
			<div className="session-strip">
				{sessions.map((session) => (
					<button
						type="button"
						key={session.id}
						className={session.id === selectedSessionId ? "active" : ""}
						onClick={() => onSelectSession(session)}
					>
						{session.title}
					</button>
				))}
			</div>

			<div className="messages">
				{messages.length === 0 ? (
					<div className="empty">No messages yet.</div>
				) : null}
				{messages.map((message, index) => (
					<article
						key={message.id ?? `${message.role}-${index}`}
						className={`message ${message.role}`}
					>
						<span>{message.role}</span>
						<div>{renderParts(message.content)}</div>
					</article>
				))}
			</div>

			<InteractionDock
				interactions={pendingInteractions}
				onRespond={onRespondToInteraction}
			/>

			<form
				className="composer"
				onSubmit={(event) => {
					event.preventDefault();
					onSendPrompt();
				}}
			>
				<textarea
					value={prompt}
					onChange={(event) => onPromptChange(event.target.value)}
					placeholder="Send a prompt..."
					rows={1}
				/>
				<button type="button" className="icon-button" onClick={onStop}>
					<Square />
				</button>
				<button type="submit" disabled={sending || !prompt.trim()}>
					<Send />
				</button>
			</form>
		</section>
	);
}
