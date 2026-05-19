import { type KeyboardEvent, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentStreamEvent } from "@/lib/api";
import { respondToPiUi } from "@/lib/api";

type PiUiRequestEvent = Extract<AgentStreamEvent, { kind: "piUiRequest" }>;

type PiUiState =
	| {
			type: "select";
			interactionId: string;
			title: string;
			options: string[];
	  }
	| {
			type: "confirm";
			interactionId: string;
			title: string;
			message: string;
	  }
	| {
			type: "input";
			interactionId: string;
			title: string;
			placeholder: string;
	  }
	| null;

export function usePiUiInteraction() {
	const [piUiState, setPiUiState] = useState<PiUiState>(null);
	const [inputAnswer, setInputAnswer] = useState("");

	const handlePiUiRequest = useCallback((event: PiUiRequestEvent) => {
		if (event.uiKind === "select") {
			setPiUiState({
				type: "select",
				interactionId: event.interactionId,
				title: event.payload.title ?? "Select an option",
				options: event.payload.options,
			});
			return;
		}

		if (event.uiKind === "confirm") {
			setPiUiState({
				type: "confirm",
				interactionId: event.interactionId,
				title: event.payload.title ?? "Confirm",
				message: event.payload.message ?? "",
			});
			return;
		}

		if (event.uiKind === "input") {
			setInputAnswer("");
			setPiUiState({
				type: "input",
				interactionId: event.interactionId,
				title: event.payload.title ?? "Enter text",
				placeholder: event.payload.placeholder ?? "",
			});
		}
	}, []);

	const respond = useCallback(
		async (interactionId: string, result: unknown) => {
			try {
				await respondToPiUi(interactionId, result);
			} catch (error) {
				console.error(
					"[conversation] failed to respond to Pi UI request:",
					error,
				);
			}
		},
		[],
	);

	const handleSelect = useCallback(
		async (option: string) => {
			if (!piUiState || piUiState.type !== "select") return;
			const { interactionId } = piUiState;
			setPiUiState(null);
			await respond(interactionId, option);
		},
		[piUiState, respond],
	);

	const handleConfirm = useCallback(
		async (confirmed: boolean) => {
			if (!piUiState || piUiState.type !== "confirm") return;
			const { interactionId } = piUiState;
			setPiUiState(null);
			await respond(interactionId, confirmed);
		},
		[piUiState, respond],
	);

	const handleInput = useCallback(async () => {
		if (!piUiState || piUiState.type !== "input") return;
		const { interactionId } = piUiState;
		const value = inputAnswer.trim();
		setPiUiState(null);
		setInputAnswer("");
		await respond(interactionId, value || null);
	}, [piUiState, inputAnswer, respond]);

	const handleInputCancel = useCallback(async () => {
		if (!piUiState || piUiState.type !== "input") return;
		const { interactionId } = piUiState;
		setPiUiState(null);
		setInputAnswer("");
		await respond(interactionId, null);
	}, [piUiState, respond]);

	const accessory = useMemo(() => {
		if (!piUiState) return null;

		return (
			<div className="mb-3">
				{piUiState.type === "select" && (
					<PiSelectCard state={piUiState} onSelect={handleSelect} />
				)}
				{piUiState.type === "confirm" && (
					<PiConfirmCard state={piUiState} onConfirm={handleConfirm} />
				)}
				{piUiState.type === "input" && (
					<PiInputCard
						state={piUiState}
						value={inputAnswer}
						onChange={setInputAnswer}
						onSubmit={handleInput}
						onCancel={handleInputCancel}
					/>
				)}
			</div>
		);
	}, [
		piUiState,
		handleSelect,
		handleConfirm,
		inputAnswer,
		handleInput,
		handleInputCancel,
	]);

	return { accessory, handlePiUiRequest };
}

function PiSelectCard({
	state,
	onSelect,
}: {
	state: Extract<PiUiState, { type: "select" }>;
	onSelect: (option: string) => void;
}) {
	return (
		<div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
			<div className="mb-2 text-[12px] font-medium text-foreground">
				{state.title}
			</div>
			<div className="flex flex-col gap-1.5">
				{state.options.map((option) => (
					<Button
						key={option}
						type="button"
						variant="outline"
						size="sm"
						className="h-7 cursor-pointer justify-start text-[12px]"
						onClick={() => onSelect(option)}
					>
						{option}
					</Button>
				))}
			</div>
		</div>
	);
}

function PiConfirmCard({
	state,
	onConfirm,
}: {
	state: Extract<PiUiState, { type: "confirm" }>;
	onConfirm: (confirmed: boolean) => void;
}) {
	return (
		<div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
			<div className="mb-1 text-[12px] font-medium text-foreground">
				{state.title}
			</div>
			{state.message ? (
				<p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
					{state.message}
				</p>
			) : null}
			<div className="flex gap-2">
				<Button
					type="button"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={() => onConfirm(true)}
				>
					Yes
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={() => onConfirm(false)}
				>
					No
				</Button>
			</div>
		</div>
	);
}

function PiInputCard({
	state,
	value,
	onChange,
	onSubmit,
	onCancel,
}: {
	state: Extract<PiUiState, { type: "input" }>;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				onSubmit();
			}
		},
		[onSubmit],
	);

	return (
		<div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
			<div className="mb-2 text-[12px] font-medium text-foreground">
				{state.title}
			</div>
			<Textarea
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={state.placeholder}
				className="min-h-[72px] resize-none text-[12px]"
			/>
			<div className="mt-2 flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={onSubmit}
				>
					Send
				</Button>
			</div>
		</div>
	);
}
