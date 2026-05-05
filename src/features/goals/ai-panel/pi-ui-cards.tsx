/**
 * Interactive Pi UI cards — rendered when Pi requests a user choice
 * (select, confirm, or text input) mid-stream.
 */
import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PiUiState } from "./types";

type SelectProps = {
	state: Extract<PiUiState, { type: "select" }>;
	onSelect: (option: string) => void;
};

export function PiSelectCard({ state, onSelect }: SelectProps) {
	return (
		<div className="space-y-2 rounded-xl border border-border bg-card p-3">
			<p className="text-[12px] font-medium text-foreground">{state.title}</p>
			<div className="flex flex-col gap-1">
				{state.options.map((opt) => (
					<Button
						key={opt}
						variant="outline"
						size="sm"
						className="h-7 cursor-pointer justify-start text-[12px]"
						onClick={() => onSelect(opt)}
					>
						{opt}
					</Button>
				))}
			</div>
		</div>
	);
}

type ConfirmProps = {
	state: Extract<PiUiState, { type: "confirm" }>;
	onConfirm: (confirmed: boolean) => void;
};

export function PiConfirmCard({ state, onConfirm }: ConfirmProps) {
	return (
		<div className="space-y-2 rounded-xl border border-border bg-card p-3">
			<p className="text-[12px] font-medium text-foreground">{state.title}</p>
			{state.message && (
				<p className="text-[11.5px] text-muted-foreground">{state.message}</p>
			)}
			<div className="flex gap-2">
				<Button
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={() => onConfirm(true)}
				>
					Yes
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={() => onConfirm(false)}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

type InputProps = {
	state: Extract<PiUiState, { type: "input" }>;
	value: string;
	onChange: (v: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
};

export function PiInputCard({
	state,
	value,
	onChange,
	onSubmit,
	onCancel,
}: InputProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				onSubmit();
			} else if (e.key === "Escape") {
				onCancel();
			}
		},
		[onSubmit, onCancel],
	);

	return (
		<div className="space-y-2 rounded-xl border border-border bg-card p-3">
			<p className="text-[12px] font-medium text-foreground">{state.title}</p>
			<Textarea
				ref={textareaRef}
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={state.placeholder}
				className="max-h-[80px] min-h-[40px] resize-none text-[12.5px]"
				onKeyDown={handleKeyDown}
			/>
			<div className="flex gap-2">
				<Button
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={onSubmit}
				>
					Submit
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 cursor-pointer text-[12px]"
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}
