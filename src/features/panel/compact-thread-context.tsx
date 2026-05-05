import { createContext, useContext } from "react";

/**
 * Set to `true` inside compact-mode panels (e.g. the Pi goals sidebar) so
 * that message sub-components can adapt: reasoning blocks collapse by default,
 * etc.
 */
export const CompactThreadContext = createContext(false);

export function useCompactThread(): boolean {
	return useContext(CompactThreadContext);
}
