/**
 * Composer — the text input + send button at the bottom of the Pi panel.
 */
import { Loader2, Send } from "lucide-react";
import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ComposerProps = {
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	disabled: boolean;
	streaming: boolean;
	sessionReady: boolean;
};

export function Composer({
	value,
	onChange,
	onSend,
	disabled,
	streaming,
	sessionReady,
}: ComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				onSend();
			}
		},
		[onSend],
	);

	return (
		<div className="shrink-0 border-t border-border/60 p-2">
			<div className="flex items-end gap-1.5">
				<Textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask Pi to manage the board…"
					className="max-h-[120px] min-h-[56px] resize-none text-[12.5px] leading-snug"
					disabled={disabled || !sessionReady}
				/>
				<Button
					size="icon"
					className="size-8 shrink-0 cursor-pointer"
					onClick={onSend}
					disabled={disabled || !value.trim() || !sessionReady}
				>
					{streaming ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Send className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
}
