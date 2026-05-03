import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { replacePiModels } from "@/lib/agent-models";
import { type AgentModelSection, checkPiModels } from "@/lib/api";
import {
	agentModelSectionsQueryOptions,
	helmorQueryKeys,
} from "@/lib/query-client";

export function useRefreshPiModels() {
	const queryClient = useQueryClient();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const refreshStartedRef = useRef(false);

	useEffect(() => {
		if (refreshStartedRef.current) return;
		if (modelSectionsQuery.status !== "success") return;
		refreshStartedRef.current = true;

		void checkPiModels()
			.then((result) => {
				if (result.status === "error" || result.models.length === 0) return;
				queryClient.setQueryData<AgentModelSection[]>(
					helmorQueryKeys.agentModelSections,
					(current) => replacePiModels(current, result.models),
				);
			})
			.catch((error) => {
				console.debug("[models] automatic Pi model refresh failed", error);
			});
	}, [modelSectionsQuery.status, queryClient]);
}
