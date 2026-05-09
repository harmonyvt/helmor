/**
 * Consent dialog shown when the user switches between Claude and Codex in a
 * session that already has messages. Gives the user a chance to carry the
 * conversation history across to the new provider (via a context-transfer
 * prefix) or start a clean new session.
 */

import { ArrowRight, Box } from "lucide-react";
import { useEffect, useState } from "react";
import { ClaudeIcon, OpenAIIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AgentProvider } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ProviderSwapChoice = "bring-history" | "start-fresh";

type ProviderSwapDialogProps = {
	open: boolean;
	fromProvider: AgentProvider;
	toProvider: AgentProvider;
	onChoose: (choice: ProviderSwapChoice) => void;
	onCancel: () => void;
};

const PROVIDER_LABELS: Record<AgentProvider, string> = {
	claude: "Claude",
	codex: "OpenAI Codex",
	pi: "Pi",
};

function ProviderIcon({
	provider,
	className,
}: {
	provider: AgentProvider;
	className?: string;
}) {
	if (provider === "codex") {
		return <OpenAIIcon className={cn("size-4 shrink-0", className)} />;
	}
	if (provider === "pi") {
		return (
			<Box className={cn("size-4 shrink-0", className)} strokeWidth={1.8} />
		);
	}
	return <ClaudeIcon className={cn("size-4 shrink-0", className)} />;
}

export function ProviderSwapDialog({
	open,
	fromProvider,
	toProvider,
	onChoose,
	onCancel,
}: ProviderSwapDialogProps) {
	const [choice, setChoice] = useState<ProviderSwapChoice>("bring-history");

	const fromLabel = PROVIDER_LABELS[fromProvider];
	const toLabel = PROVIDER_LABELS[toProvider];

	useEffect(() => {
		console.info("[provider-swap-debug] render", {
			open,
			fromProvider,
			toProvider,
			choice,
		});
	});

	const handleConfirm = () => {
		console.info("[provider-swap-debug] confirm", {
			fromProvider,
			toProvider,
			choice,
		});
		onChoose(choice);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				console.info("[provider-swap-debug] open change", {
					isOpen,
					fromProvider,
					toProvider,
					choice,
				});
				if (!isOpen) onCancel();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[15px]">
						Switch to {toLabel}?
					</DialogTitle>
					<DialogDescription className="text-[13px]">
						This will start a new session. Choose how to handle your
						conversation history.
					</DialogDescription>
				</DialogHeader>

				{/* Provider transition display */}
				<div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
					<div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
						<ProviderIcon provider={fromProvider} />
						<span>{fromLabel}</span>
					</div>
					<ArrowRight
						className="size-3.5 shrink-0 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
						<ProviderIcon provider={toProvider} />
						<span>{toLabel}</span>
					</div>
				</div>

				{/* Choice selection */}
				<RadioGroup
					value={choice}
					onValueChange={(v) => {
						console.info("[provider-swap-debug] choice change", {
							fromProvider,
							toProvider,
							choice: v,
						});
						setChoice(v as ProviderSwapChoice);
					}}
					className="gap-2"
				>
					<label
						htmlFor="swap-bring-history"
						className={cn(
							"flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
							choice === "bring-history"
								? "border-primary/50 bg-primary/5"
								: "border-border bg-transparent hover:bg-muted/40",
						)}
					>
						<RadioGroupItem
							id="swap-bring-history"
							value="bring-history"
							className="mt-0.5"
						/>
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium leading-snug">
								Bring conversation history
							</span>
							<span className="text-[12px] leading-snug text-muted-foreground">
								Your previous messages will be sent as context so {toLabel} can
								pick up where {fromLabel} left off.
							</span>
						</div>
					</label>

					<label
						htmlFor="swap-start-fresh"
						className={cn(
							"flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
							choice === "start-fresh"
								? "border-primary/50 bg-primary/5"
								: "border-border bg-transparent hover:bg-muted/40",
						)}
					>
						<RadioGroupItem
							id="swap-start-fresh"
							value="start-fresh"
							className="mt-0.5"
						/>
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium leading-snug">
								Start fresh
							</span>
							<span className="text-[12px] leading-snug text-muted-foreground">
								Begin a clean conversation with {toLabel}, without any previous
								context.
							</span>
						</div>
					</label>
				</RadioGroup>

				<DialogFooter className="gap-2 sm:gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							console.info("[provider-swap-debug] cancel button", {
								fromProvider,
								toProvider,
								choice,
							});
							onCancel();
						}}
						className="cursor-pointer"
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleConfirm} className="cursor-pointer">
						Switch &amp; Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
