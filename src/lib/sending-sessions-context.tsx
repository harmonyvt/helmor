import { createContext, useContext } from "react";

/** Currently-streaming session ids; consumed by hover card / indicators. */
const EMPTY_SET: ReadonlySet<string> = new Set();

const SendingSessionsContext = createContext<ReadonlySet<string>>(EMPTY_SET);

export const SendingSessionsProvider = SendingSessionsContext.Provider;

export function useSendingSessionIds(): ReadonlySet<string> {
	return useContext(SendingSessionsContext);
}
