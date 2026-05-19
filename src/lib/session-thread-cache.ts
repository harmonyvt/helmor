/**
 * Session thread cache: thin write helpers around React Query's
 * `[...sessionMessages(sessionId), "thread"]` entry.
 *
 * This cache is the **single source of truth** for the rendered
 * conversation thread of a session. The historical (DB) load path,
 * the live streaming path, and the panel render path all read and
 * write through here.
 *
 * Each helper preserves structural sharing via `shareMessages` so
 * downstream per-message memos can bail out cleanly across cache
 * updates — a Tauri stream tick that doesn't change message content
 * still produces the previous outer array reference, which is what
 * keeps the conversation list from cascading re-renders.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { StreamingTextDelta, ThreadMessageLike } from "./api";
import { helmorQueryKeys } from "./query-client";
import { messagesStructurallyEqual } from "./structural-equality";

/** Cache key for a session's rendered thread messages. */
export function sessionThreadCacheKey(sessionId: string): readonly unknown[] {
	return [...helmorQueryKeys.sessionMessages(sessionId), "thread"];
}

/**
 * Reuse `prev` message references whenever the new array contains an
 * id-matched message that's structurally equivalent. The outer array
 * reference is also reused if every individual message could be reused
 * AND no count change happened — that's the condition the upstream
 * `MemoConversationMessage` `prev === next` bail-out depends on.
 *
 * Pure function. Pinned by the truth-table tests in
 * `session-thread-cache.share.test.ts`.
 */
export function shareMessages(
	prev: ThreadMessageLike[],
	next: ThreadMessageLike[],
): ThreadMessageLike[] {
	if (prev === next) return next;
	const prevById = new Map<string, ThreadMessageLike>();
	for (const message of prev) {
		if (message.id != null) prevById.set(message.id, message);
	}
	let allReused = next.length === prev.length;
	const shared = next.map((message, index) => {
		const candidate = message.id != null ? prevById.get(message.id) : undefined;
		if (candidate && messagesStructurallyEqual(candidate, message)) {
			if (allReused && prev[index] !== candidate) {
				allReused = false;
			}
			return candidate;
		}
		allReused = false;
		return message;
	});
	return allReused ? prev : shared;
}

/** Snapshot of the cached thread for a session, used for rollback. */
export type SessionThreadSnapshot = ThreadMessageLike[] | undefined;

/**
 * Read the current cached thread for a session. Returns `undefined` if
 * the cache has never been populated for this id (which is distinct
 * from "populated as empty array" — a fetched empty session).
 */
export function readSessionThread(
	queryClient: QueryClient,
	sessionId: string,
): SessionThreadSnapshot {
	return queryClient.getQueryData<ThreadMessageLike[]>(
		sessionThreadCacheKey(sessionId),
	);
}

/**
 * Write a thread snapshot back to the cache, applying structural
 * sharing against the existing entry. The previous `gcTime` /
 * `staleTime` settings on the query options are preserved.
 */
function writeSessionThread(
	queryClient: QueryClient,
	sessionId: string,
	next: ThreadMessageLike[],
): void {
	const cacheKey = sessionThreadCacheKey(sessionId);
	queryClient.setQueryData<ThreadMessageLike[]>(cacheKey, (prev) =>
		shareMessages(prev ?? [], next),
	);
}

/**
 * Optimistically append a freshly-typed user message to the cached
 * thread. Used by the composer submit path so the user's bubble
 * appears immediately, before the streaming response begins.
 *
 * Returns the snapshot the caller should hold onto for rollback if
 * the stream errors out before any messages are persisted.
 */
export function appendUserMessage(
	queryClient: QueryClient,
	sessionId: string,
	userMessage: ThreadMessageLike,
): SessionThreadSnapshot {
	const snapshot = readSessionThread(queryClient, sessionId);
	const next = [...(snapshot ?? []), userMessage];
	writeSessionThread(queryClient, sessionId, next);
	return snapshot;
}

/**
 * Replace the streaming "tail" of the cached thread — everything from
 * the just-sent user message onwards — with the latest snapshot from
 * the Tauri pipeline. Called on every `update` and `streamingPartial`
 * tick.
 *
 * The boundary is identified by `userMessageId`: anything before the
 * matching message in the cache is treated as immutable history,
 * anything from it onwards (including itself) is replaced with the
 * provided turn. This makes the helper resilient to multi-turn
 * resumes — prior turns stay structurally identical and the new turn
 * grows in place.
 */
export function replaceStreamingTail(
	queryClient: QueryClient,
	sessionId: string,
	userMessageId: string,
	turn: ThreadMessageLike[],
): void {
	const cacheKey = sessionThreadCacheKey(sessionId);
	queryClient.setQueryData<ThreadMessageLike[]>(cacheKey, (prev) => {
		const prior = prev ?? [];
		const turnIds = messageIdSet(turn);
		const boundary = prior.findIndex((m) => m.id === userMessageId);
		const fallbackBoundary =
			boundary >= 0 ? boundary : firstMatchingMessageIndex(prior, turnIds);
		const stable =
			fallbackBoundary >= 0
				? prior.slice(0, fallbackBoundary)
				: prior.filter((message) => !messageIdInSet(message, turnIds));
		const externalTail =
			fallbackBoundary >= 0
				? collectExternalTailMessages(prior.slice(fallbackBoundary), turn)
				: [];
		// `turn` already begins with the user message — the stream
		// pipeline rebuilds it from the optimistic seed plus assistant
		// snapshot every tick.
		const next = [
			...stable,
			...mergeTurnWithExternalMessages(turn, externalTail),
		];
		return shareMessages(prior, next);
	});
}

function firstMatchingMessageIndex(
	messages: ThreadMessageLike[],
	ids: Set<string>,
): number {
	return messages.findIndex((message) => messageIdInSet(message, ids));
}

function collectExternalTailMessages(
	priorTail: ThreadMessageLike[],
	turn: ThreadMessageLike[],
): ThreadMessageLike[] {
	const turnIds = messageIdSet(turn);
	return priorTail.filter(
		(message) =>
			message.role === "system" &&
			message.streaming !== true &&
			message.id != null &&
			!turnIds.has(message.id),
	);
}

function messageIdSet(messages: ThreadMessageLike[]): Set<string> {
	return new Set(
		messages
			.map((message) => message.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0),
	);
}

function messageIdInSet(message: ThreadMessageLike, ids: Set<string>): boolean {
	return typeof message.id === "string" && ids.has(message.id);
}

function mergeTurnWithExternalMessages(
	turn: ThreadMessageLike[],
	externalTail: ThreadMessageLike[],
): ThreadMessageLike[] {
	if (externalTail.length === 0) return turn;

	return [...turn, ...externalTail]
		.map((message, index) => ({ message, index }))
		.sort((a, b) => {
			const aTime = messageTime(a.message);
			const bTime = messageTime(b.message);
			if (aTime !== bTime) return aTime - bTime;
			return a.index - b.index;
		})
		.map((entry) => entry.message);
}

function messageTime(message: ThreadMessageLike): number {
	if (!message.createdAt) return Number.POSITIVE_INFINITY;
	const time = Date.parse(message.createdAt);
	return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Merge a live partial from a background stream into the cached thread.
 *
 * Foreground composer streams know the just-sent user message id and can use
 * `replaceStreamingTail`. Background assignee streams arrive through global UI
 * sync, so they only know the session id and the latest rendered assistant
 * partial. Prefer id replacement, then fall back to replacing the current
 * trailing streaming assistant row, otherwise append the partial.
 */
export function mergeStreamingPartial(
	queryClient: QueryClient,
	sessionId: string,
	message: ThreadMessageLike,
): void {
	const cacheKey = sessionThreadCacheKey(sessionId);
	queryClient.setQueryData<ThreadMessageLike[]>(cacheKey, (prev) => {
		const prior = prev ?? [];
		const next = [...prior];
		const id = message.id;
		const idMatch = id ? next.findIndex((entry) => entry.id === id) : -1;

		if (idMatch >= 0) {
			next[idMatch] = message;
			return shareMessages(prior, next);
		}

		const tailIndex = next.length - 1;
		const tail = tailIndex >= 0 ? next[tailIndex] : null;
		if (tail?.role === "assistant" && tail.streaming === true) {
			next[tailIndex] = message;
			return shareMessages(prior, next);
		}

		next.push(message);
		return shareMessages(prior, next);
	});
}

/**
 * Patch an append-only text delta into a cached background stream.
 *
 * Foreground streams batch deltas in `useConversationStreaming`; background
 * streams arrive through UI sync and need the same compact cache update here.
 * If the matching message/part is not present, leave the cache unchanged so a
 * later structural `streamingPartial` can re-anchor the stream safely.
 */
export function mergeStreamingDelta(
	queryClient: QueryClient,
	sessionId: string,
	delta: StreamingTextDelta,
): void {
	const cacheKey = sessionThreadCacheKey(sessionId);
	queryClient.setQueryData<ThreadMessageLike[]>(cacheKey, (prev) => {
		const prior = prev ?? [];
		let changed = false;
		const next = prior.map((message) => {
			if (message.id !== delta.messageId) return message;

			let partChanged = false;
			const content = message.content.map((part) => {
				if (
					delta.partType === "text" &&
					part.type === "text" &&
					part.id === delta.partId
				) {
					partChanged = true;
					return { ...part, text: `${part.text}${delta.textDelta}` };
				}

				if (
					delta.partType === "reasoning" &&
					part.type === "reasoning" &&
					part.id === delta.partId
				) {
					partChanged = true;
					return { ...part, text: `${part.text}${delta.textDelta}` };
				}

				return part;
			});

			if (!partChanged) return message;
			changed = true;
			return { ...message, content, streaming: true };
		});

		return changed ? shareMessages(prior, next) : prior;
	});
}

/**
 * Restore a previously captured snapshot. Used for full rollback when
 * a stream errors out before any messages are persisted server-side.
 */
export function restoreSnapshot(
	queryClient: QueryClient,
	sessionId: string,
	snapshot: SessionThreadSnapshot,
): void {
	const cacheKey = sessionThreadCacheKey(sessionId);
	if (snapshot === undefined) {
		queryClient.removeQueries({ queryKey: cacheKey, exact: true });
		return;
	}
	queryClient.setQueryData<ThreadMessageLike[]>(cacheKey, snapshot);
}
