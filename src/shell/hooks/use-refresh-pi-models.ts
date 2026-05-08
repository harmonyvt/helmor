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

		console.info("[models-debug] automatic Pi model refresh started", {
			staticSectionCount: modelSectionsQuery.data?.length ?? 0,
			staticPiCount:
				modelSectionsQuery.data?.find((section) => section.id === "pi")?.options
					.length ?? 0,
		});
		void checkPiModels()
			.then(async (result) => {
				console.info("[models-debug] automatic Pi model refresh result", {
					status: result.status,
					modelCount: result.models.length,
					providerCount: result.providers.length,
					providers: result.providers.map((provider) => ({
						key: provider.key,
						modelCount: provider.modelCount,
					})),
					error: result.error ?? null,
				});
				if (result.status === "error" || result.models.length === 0) return;
				await queryClient.cancelQueries({
					queryKey: helmorQueryKeys.agentModelSections,
				});
				queryClient.setQueryData<AgentModelSection[]>(
					helmorQueryKeys.agentModelSections,
					(current) => replacePiModels(current, result.models),
				);
				console.info("[models-debug] automatic Pi model cache replaced", {
					modelCount: result.models.length,
				});
			})
			.catch((error) => {
				console.warn("[models-debug] automatic Pi model refresh failed", error);
			});
	}, [modelSectionsQuery.data, modelSectionsQuery.status, queryClient]);
}
