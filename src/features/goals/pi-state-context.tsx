import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import type { GoalPiPhysicalState } from "./types";

type GoalPiContextValue = {
	piState: GoalPiPhysicalState;
	unreadCount: number;
	setPiState: (state: GoalPiPhysicalState) => void;
	incrementUnread: () => void;
	clearUnread: () => void;
};

const GoalPiContext = createContext<GoalPiContextValue>({
	piState: "dock",
	unreadCount: 0,
	setPiState: () => {},
	incrementUnread: () => {},
	clearUnread: () => {},
});

/**
 * Provides the three-state Pi AI surface context (panel | dock | sheet).
 *
 * Place this above both GoalWorkspaceContainer and WorkspaceConversationContainer
 * so Pi state survives navigation between a goal board and its child workspaces.
 *
 * Pass `goalContextId` so the provider can reset state when the user switches
 * to an entirely different goal.
 */
export function GoalPiStateProvider({
	goalContextId,
	children,
}: {
	goalContextId: string | null;
	children: React.ReactNode;
}) {
	const [piState, setPiStateRaw] = useState<GoalPiPhysicalState>("dock");
	const [unreadCount, setUnreadCount] = useState(0);
	const prevGoalContextId = useRef<string | null>(null);

	// Reset state when navigating to a different goal entirely.
	useEffect(() => {
		if (goalContextId !== null && goalContextId !== prevGoalContextId.current) {
			setPiStateRaw("dock");
			setUnreadCount(0);
		}
		prevGoalContextId.current = goalContextId;
	}, [goalContextId]);

	const setPiState = useCallback((state: GoalPiPhysicalState) => {
		setPiStateRaw(state);
		// Opening Pi clears the unread badge.
		if (state !== "dock") {
			setUnreadCount(0);
		}
	}, []);

	const incrementUnread = useCallback(() => {
		setUnreadCount((n) => n + 1);
	}, []);

	const clearUnread = useCallback(() => {
		setUnreadCount(0);
	}, []);

	return (
		<GoalPiContext.Provider
			value={{ piState, unreadCount, setPiState, incrementUnread, clearUnread }}
		>
			{children}
		</GoalPiContext.Provider>
	);
}

export function useGoalPiState() {
	return useContext(GoalPiContext);
}
