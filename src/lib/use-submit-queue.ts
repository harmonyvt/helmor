/**
 * App-level submit queue — stores follow-up messages the user wants to
 * send once the current turn finishes.
 *
 * Why app-level instead of inside `use-streaming`: the queue must
 * survive session / workspace switches so the user can navigate away
 * from a long-running session and come back to see their queue still
 * intact. `use-streaming` is mounted per-conversation-view so its
 * state would be dropped the moment the displayed session changes.
 *
 * State lives in React state (not persisted anywhere). If the app
 * restarts the queue is lost — that's the intended trade-off: the
 * queue is a short-lived intent, not a durable artifact like a
 * message. Individual rows are identified by client-generated UUIDs
 * so row-level cancel / steer actions have stable targets across
 * re-renders.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentModelOption } from "./api";
import type { ComposerCustomTag } from "./composer-insert";

/** Minimal serialisable copy of `SubmitPayload` — enough to replay
 *  through `handleComposerSubmit` when the drain fires after the
 *  current turn ends. */
export type QueuedSubmitPayload = {
	prompt: string;
	imagePaths: string[];
	filePaths: string[];
	customTags: ComposerCustomTag[];
	model: AgentModelOption;
	workingDirectory: string | null;
	effortLevel: string;
	permissionMode: string;
	fastMode: boolean;
	debugMode?: boolean;
};

/** Context captured at enqueue time so drain / Steer can replay
 *  against the original session even if the user has since navigated
 *  elsewhere. Without this, a queued message from session A would
 *  fire into whatever session is currently displayed. */
export type QueuedSubmitContext = {
	sessionId: string;
	workspaceId: string | null;
	contextKey: string;
};

export type QueuedSubmit = {
	/** Client-generated UUID; stable across re-renders. */
	id: string;
	context: QueuedSubmitContext;
	payload: QueuedSubmitPayload;
	enqueuedAt: number;
};

export type SubmitQueueApi = {
	/** Shallow-cloned queue for the given session. Empty array when none. */
	getQueue: (sessionId: string) => QueuedSubmit[];
	/** Find an entry by id across all sessions. Undefined when not found. */
	findById: (id: string) => QueuedSubmit | undefined;
	/** Append to the queue for the enqueue-time context. Returns the generated id. */
	enqueue: (
		context: QueuedSubmitContext,
		payload: QueuedSubmitPayload,
	) => string;
	/** Remove a queued entry by id. No-op if not found. */
	remove: (sessionId: string, id: string) => void;
	/** Pop the head (FIFO) for a session. Returns undefined when empty. */
	popNext: (sessionId: string) => QueuedSubmit | undefined;
	/** Drop the entire queue for a session — used on session deletion. */
	clear: (sessionId: string) => void;
};

/** Used by the composer to render the list; `queuesBySessionId` maps
 *  sessionId → ordered list. Empty sessions are omitted from the map. */
export type SubmitQueueState = {
	queuesBySessionId: ReadonlyMap<string, readonly QueuedSubmit[]>;
	api: SubmitQueueApi;
};

const EMPTY: readonly QueuedSubmit[] = Object.freeze([]);

export function useSubmitQueue(): SubmitQueueState {
	const [queues, setQueues] = useState<Map<string, QueuedSubmit[]>>(
		() => new Map(),
	);

	// Ref mirror so read-only accessors (`getQueue`, `findById`,
	// `popNext`) don't need `queues` in their dep lists — keeping the
	// exposed `api` object identity stable across queue mutations.
	const queuesRef = useRef(queues);
	queuesRef.current = queues;

	const getQueue = useCallback(
		(sessionId: string): QueuedSubmit[] =>
			queuesRef.current.get(sessionId)?.slice() ?? [],
		[],
	);

	const findById = useCallback((id: string): QueuedSubmit | undefined => {
		for (const entries of queuesRef.current.values()) {
			const match = entries.find((e) => e.id === id);
			if (match) return match;
		}
		return undefined;
	}, []);

	const enqueue = useCallback(
		(context: QueuedSubmitContext, payload: QueuedSubmitPayload): string => {
			const id = crypto.randomUUID();
			const entry: QueuedSubmit = {
				id,
				context,
				payload,
				enqueuedAt: Date.now(),
			};
			setQueues((prev) => {
				const next = new Map(prev);
				const existing = next.get(context.sessionId) ?? [];
				next.set(context.sessionId, [...existing, entry]);
				return next;
			});
			return id;
		},
		[],
	);

	const remove = useCallback((sessionId: string, id: string): void => {
		setQueues((prev) => {
			const existing = prev.get(sessionId);
			if (!existing) return prev;
			const filtered = existing.filter((e) => e.id !== id);
			if (filtered.length === existing.length) return prev;
			const next = new Map(prev);
			if (filtered.length === 0) next.delete(sessionId);
			else next.set(sessionId, filtered);
			return next;
		});
	}, []);

	const popNext = useCallback((sessionId: string): QueuedSubmit | undefined => {
		const existing = queuesRef.current.get(sessionId);
		if (!existing || existing.length === 0) return undefined;
		const head = existing[0];
		setQueues((prev) => {
			const cur = prev.get(sessionId);
			if (!cur || cur.length === 0) return prev;
			const rest = cur.slice(1);
			const next = new Map(prev);
			if (rest.length === 0) next.delete(sessionId);
			else next.set(sessionId, rest);
			return next;
		});
		return head;
	}, []);

	const clear = useCallback((sessionId: string): void => {
		setQueues((prev) => {
			if (!prev.has(sessionId)) return prev;
			const next = new Map(prev);
			next.delete(sessionId);
			return next;
		});
	}, []);

	// `queues` is already a `Map<string, QueuedSubmit[]>` — just widen
	// the type to ReadonlyMap + readonly arrays at the boundary. No
	// copy needed; we never mutate in place (always `new Map(prev)`).
	const queuesBySessionId = queues as ReadonlyMap<
		string,
		readonly QueuedSubmit[]
	>;

	const api = useMemo<SubmitQueueApi>(
		() => ({ getQueue, findById, enqueue, remove, popNext, clear }),
		[getQueue, findById, enqueue, remove, popNext, clear],
	);

	return { queuesBySessionId, api };
}

export const EMPTY_QUEUE: readonly QueuedSubmit[] = EMPTY;
