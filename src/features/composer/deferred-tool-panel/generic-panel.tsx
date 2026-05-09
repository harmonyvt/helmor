import { Check, Settings2, X } from "lucide-react";
import { useMemo } from "react";
import { CodeBlock } from "@/components/ai/code-block";
import { Button } from "@/components/ui/button";
import { InteractionFooter, InteractionHeader } from "../interaction";
import { DeferredToolCard, type DeferredToolPanelProps } from "./shared";

function looksLikeCommand(
	toolName: string,
	toolInput: Record<string, unknown>,
) {
	const lowerName = toolName.toLowerCase();
	return (
		typeof toolInput.command === "string" &&
		toolInput.command.length > 0 &&
		(lowerName === "bash" || lowerName === "shell" || lowerName === "exec")
	);
}

function getCodePreview(deferred: DeferredToolPanelProps["deferred"]): {
	code: string;
	language: string;
} {
	const command = deferred.toolInput?.command;
	if (
		typeof command === "string" &&
		command.length > 0 &&
		looksLikeCommand(deferred.toolName, deferred.toolInput)
	) {
		return { code: command, language: "bash" };
	}
	return {
		code: JSON.stringify(deferred.toolInput, null, 2),
		language: "json",
	};
}

export function GenericDeferredToolPanel({
	deferred,
	disabled,
	onResponse,
}: DeferredToolPanelProps) {
	const preview = useMemo(() => getCodePreview(deferred), [deferred]);

	return (
		<DeferredToolCard>
			<InteractionHeader
				icon={Settings2}
				title={deferred.toolName}
				description="This tool needs your approval before it can run."
				truncateTitle
			/>
			<div className="mx-1 max-h-56 overflow-y-auto rounded-xl bg-muted/20">
				<CodeBlock
					code={preview.code}
					language={preview.language}
					variant="plain"
					wrapLines
				/>
			</div>

			<InteractionFooter>
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => onResponse(deferred, "deny")}
				>
					<X className="size-3.5" strokeWidth={2} />
					<span>Deny</span>
				</Button>
				<Button
					variant="default"
					size="sm"
					disabled={disabled}
					onClick={() =>
						onResponse(deferred, "allow", {
							updatedInput: deferred.toolInput,
						})
					}
				>
					<Check className="size-3.5" strokeWidth={2} />
					<span>Allow</span>
				</Button>
			</InteractionFooter>
		</DeferredToolCard>
	);
}
