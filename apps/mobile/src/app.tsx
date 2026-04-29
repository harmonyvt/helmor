import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type AgentStreamEvent,
	api,
	clearToken,
	loadToken,
	openEventStream,
	saveToken,
	type ThreadMessage,
	type WorkspaceGroup,
	type WorkspaceRow,
	type WorkspaceSession,
} from "./api";
import type { PendingInteraction } from "./interactions";
import { PairingScreen } from "./pairing-screen";
import { handleAgentEvent, respond } from "./stream-events";
import { ThreadView } from "./thread-view";
import { Topbar } from "./topbar";
import { WorkspaceList } from "./workspace-list";

type View = "workspaces" | "thread";

export function App() {
	const [token, setToken] = useState(loadToken);
	const [draftToken, setDraftToken] = useState("");
	const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
	const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
	const [messages, setMessages] = useState<ThreadMessage[]>([]);
	const [selectedWorkspace, setSelectedWorkspace] =
		useState<WorkspaceRow | null>(null);
	const [selectedSession, setSelectedSession] =
		useState<WorkspaceSession | null>(null);
	const [view, setView] = useState<View>("workspaces");
	const [prompt, setPrompt] = useState("");
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pendingInteractions, setPendingInteractions] = useState<
		PendingInteraction[]
	>([]);

	const workspaces = useMemo(
		() => groups.flatMap((group) => group.rows.map((row) => ({ ...row }))),
		[groups],
	);

	const refreshWorkspaces = useCallback(async () => {
		if (!token) return;
		setLoading(true);
		setError(null);
		try {
			await api.bootstrap(token);
			const nextGroups = await api.workspaces(token);
			setGroups(nextGroups);
			if (!selectedWorkspace) {
				const first = nextGroups.flatMap((group) => group.rows)[0] ?? null;
				setSelectedWorkspace(first);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [selectedWorkspace, token]);

	const refreshSessions = useCallback(
		async (workspaceId = selectedWorkspace?.id) => {
			if (!token || !workspaceId) return;
			const next = await api.sessions(token, workspaceId);
			setSessions(next);
			setSelectedSession((current) => {
				const preserved = next.find((session) => session.id === current?.id);
				return (
					preserved ?? next.find((session) => session.active) ?? next[0] ?? null
				);
			});
		},
		[selectedWorkspace?.id, token],
	);

	const refreshMessages = useCallback(
		async (sessionId = selectedSession?.id) => {
			if (!token || !sessionId) return;
			const next = await api.messages(token, sessionId);
			setMessages(next);
		},
		[selectedSession?.id, token],
	);

	useEffect(() => {
		void refreshWorkspaces();
	}, [refreshWorkspaces]);

	useEffect(() => {
		void refreshSessions();
	}, [refreshSessions]);

	useEffect(() => {
		void refreshMessages();
	}, [refreshMessages]);

	useEffect(() => {
		if (!token) return;
		const controller = new AbortController();
		void openEventStream(
			token,
			(event) => {
				if (event.kind === "agentStream") {
					handleAgentEvent(event.event as AgentStreamEvent, {
						refreshMessages,
						setMessages,
						setPendingInteractions,
					});
					return;
				}
				if (event.kind !== "uiMutation") return;
				void refreshWorkspaces();
				void refreshSessions();
				void refreshMessages();
			},
			controller.signal,
		).catch(() => {
			if (!controller.signal.aborted) {
				setError("Live connection dropped. Pull to refresh or reopen Helmor.");
			}
		});
		return () => controller.abort();
	}, [refreshMessages, refreshSessions, refreshWorkspaces, token]);

	const pair = useCallback(() => {
		const next = draftToken.trim();
		if (!next) return;
		saveToken(next);
		setToken(next);
		setDraftToken("");
	}, [draftToken]);

	const signOut = useCallback(() => {
		clearToken();
		setToken("");
		setGroups([]);
		setSessions([]);
		setMessages([]);
		setSelectedWorkspace(null);
		setSelectedSession(null);
		setView("workspaces");
	}, []);

	const openWorkspace = useCallback(
		async (workspace: WorkspaceRow) => {
			setSelectedWorkspace(workspace);
			setView("thread");
			await refreshSessions(workspace.id);
		},
		[refreshSessions],
	);

	const sendPrompt = useCallback(async () => {
		const trimmed = prompt.trim();
		if (!token || !trimmed || !selectedWorkspace || !selectedSession) return;
		setSending(true);
		setError(null);
		try {
			await api.send(token, selectedSession.id, {
				workspaceId: selectedWorkspace.id,
				prompt: trimmed,
				modelId: selectedSession.model,
			});
			setPrompt("");
			await refreshMessages(selectedSession.id);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSending(false);
		}
	}, [prompt, refreshMessages, selectedSession, selectedWorkspace, token]);

	const stop = useCallback(async () => {
		if (!token || !selectedSession) return;
		await api.stop(token, selectedSession.id);
	}, [selectedSession, token]);

	const respondToInteraction = useCallback(
		async (interaction: PendingInteraction, approved: boolean) => {
			if (!token) return;
			setError(null);
			try {
				await respond(token, interaction, approved);
				setPendingInteractions((current) =>
					current.filter((item) => item.id !== interaction.id),
				);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[token],
	);

	if (!token) {
		return (
			<PairingScreen
				draftToken={draftToken}
				onDraftTokenChange={setDraftToken}
				onPair={pair}
			/>
		);
	}

	return (
		<main className="app-shell">
			<Topbar
				view={view}
				workspaceTitle={selectedWorkspace?.title}
				sessionTitle={selectedSession?.title}
				onBackOrRefresh={() =>
					view === "thread" ? setView("workspaces") : void refreshWorkspaces()
				}
				onSignOut={signOut}
			/>
			{error ? <div className="error">{error}</div> : null}
			{view === "workspaces" ? (
				<WorkspaceList
					loading={loading}
					workspaces={workspaces}
					onOpenWorkspace={(workspace) => void openWorkspace(workspace)}
				/>
			) : (
				<ThreadView
					sessions={sessions}
					selectedSessionId={selectedSession?.id}
					messages={messages}
					prompt={prompt}
					sending={sending}
					pendingInteractions={pendingInteractions}
					onSelectSession={setSelectedSession}
					onPromptChange={setPrompt}
					onSendPrompt={() => void sendPrompt()}
					onStop={() => void stop()}
					onRespondToInteraction={(interaction, approved) =>
						void respondToInteraction(interaction, approved)
					}
				/>
			)}
		</main>
	);
}
