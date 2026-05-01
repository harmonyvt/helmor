import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type GithubCliStatus,
	loadGithubCliStatus,
	openForgeCliAuthTerminal,
} from "@/lib/api";
import { describeUnknownError } from "@/lib/workspace-helpers";
import { getInitialGithubIdentityState } from "@/shell/layout";
import type { GithubIdentityState } from "@/shell/types";

type WorkspaceToastFn = (
	description: string,
	title?: string,
	variant?: "default" | "destructive",
) => void;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

const sonnerFallbackToast: WorkspaceToastFn = (description, title, variant) => {
	const fn = variant === "destructive" ? toast.error : toast;
	if (title) {
		fn(title, { description });
		return;
	}
	fn(description);
};

function stateFromGithubCliStatus(
	status: GithubCliStatus,
): GithubIdentityState {
	if (status.status === "ready") {
		return {
			status: "connected",
			session: {
				provider: "gh-cli",
				login: status.login,
				version: status.version,
			},
		};
	}
	if (status.status === "unauthenticated") {
		return { status: "disconnected", cliStatus: status };
	}
	return { status: "error", message: status.message, cliStatus: status };
}

export function useGithubIdentity(pushWorkspaceToast?: WorkspaceToastFn) {
	const pushToast = pushWorkspaceToast ?? sonnerFallbackToast;
	const [githubIdentityState, setGithubIdentityState] =
		useState<GithubIdentityState>(getInitialGithubIdentityState);
	const disposedRef = useRef(false);
	const pollGenerationRef = useRef(0);

	const refreshGithubIdentityState = useCallback(async () => {
		const status = await loadGithubCliStatus();
		setGithubIdentityState(stateFromGithubCliStatus(status));
	}, []);

	useEffect(() => {
		disposedRef.current = false;
		void refreshGithubIdentityState();
		return () => {
			disposedRef.current = true;
			pollGenerationRef.current += 1;
		};
	}, [refreshGithubIdentityState]);

	const pollUntilGithubCliReady = useCallback(
		async (generation: number, startedAt = Date.now()) => {
			while (!disposedRef.current && pollGenerationRef.current === generation) {
				const status = await loadGithubCliStatus();
				const nextState = stateFromGithubCliStatus(status);
				if (nextState.status === "connected") {
					setGithubIdentityState(nextState);
					pushToast(`gh connected as ${nextState.session.login}`);
					return;
				}
				if (nextState.status === "error") {
					setGithubIdentityState(nextState);
					return;
				}
				if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
					setGithubIdentityState(nextState);
					pushToast("Finish GitHub CLI auth in Terminal, then try again.");
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			}
		},
		[pushToast],
	);

	const handleStartGithubIdentityConnect = useCallback(async () => {
		const generation = pollGenerationRef.current + 1;
		pollGenerationRef.current = generation;
		setGithubIdentityState({ status: "pending" });
		try {
			await openForgeCliAuthTerminal("github", "github.com");
			pushToast("Complete GitHub CLI auth in Terminal.");
			await pollUntilGithubCliReady(generation);
		} catch (error) {
			setGithubIdentityState({
				status: "error",
				message: describeUnknownError(
					error,
					"Unable to start GitHub CLI auth.",
				),
			});
		}
	}, [pollUntilGithubCliReady, pushToast]);

	const handleCancelGithubIdentityConnect = useCallback(() => {
		pollGenerationRef.current += 1;
		void refreshGithubIdentityState();
	}, [refreshGithubIdentityState]);

	const handleDisconnectGithubIdentity = useCallback(async () => {
		pushToast("Run `gh auth logout` in Terminal to disconnect GitHub CLI.");
		await refreshGithubIdentityState();
	}, [pushToast, refreshGithubIdentityState]);

	return {
		githubIdentityState,
		handleCancelGithubIdentityConnect,
		handleDisconnectGithubIdentity,
		handleStartGithubIdentityConnect,
		refreshGithubIdentityState,
		isIdentityConnected: githubIdentityState.status === "connected",
	};
}
