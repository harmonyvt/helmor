import { useEffect, useState } from "react";
import { subscribeUiMutations } from "@/lib/api";

/**
 * Returns the set of workspace IDs whose PR-related state changed recently.
 *
 * Fires on two backend events:
 *  - `workspaceChangeRequestChanged` — PR opened, merged, closed, title changed
 *  - `workspaceForgeChanged`         — comments, reviews, CI checks updated
 *
 * Each affected workspace ID stays in the set for 3500 ms — slightly longer
 * than the 3 × 1 s shimmer animation — then is automatically removed.
 *
 * Uses the same `subscribeUiMutations` + disposed-flag pattern as
 * `use-ui-sync-bridge.ts` so no new event channel is introduced.
 */
export function useWorkspacePrFlash(): Set<string> {
	const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());

	useEffect(() => {
		let disposed = false;

		void subscribeUiMutations((event) => {
			if (disposed) return;
			if (
				event.type !== "workspaceChangeRequestChanged" &&
				event.type !== "workspaceForgeChanged"
			) {
				return;
			}

			const { workspaceId } = event;

			setFlashingIds((prev) => new Set([...prev, workspaceId]));

			window.setTimeout(() => {
				if (disposed) return;
				setFlashingIds((prev) => {
					const next = new Set(prev);
					next.delete(workspaceId);
					return next;
				});
			}, 3500);
		});

		return () => {
			disposed = true;
		};
	}, []);

	return flashingIds;
}
