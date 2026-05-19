import { useMutation } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { recordGoalKnowledgeNote } from "@/lib/api";

type KnowledgeAddNoteSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	goalWorkspaceId: string;
	repoId: string | null;
};

export function KnowledgeAddNoteSheet({
	open,
	onOpenChange,
	goalWorkspaceId,
	repoId,
}: KnowledgeAddNoteSheetProps) {
	const [title, setTitle] = useState("");
	const [text, setText] = useState("");

	const saveMutation = useMutation({
		mutationFn: () =>
			recordGoalKnowledgeNote({
				goalWorkspaceId,
				repoId,
				title: title || null,
				text,
			}),
		onSuccess: () => {
			onOpenChange(false);
			setTitle("");
			setText("");
		},
	});

	const inputClass =
		"h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border focus:ring-1 focus:ring-ring";

	const textareaClass =
		"w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-border focus:ring-1 focus:ring-ring resize-none";

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="max-w-md">
				<SheetHeader>
					<SheetTitle>Add knowledge note</SheetTitle>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 py-4">
					<div className="flex flex-col gap-1.5">
						<label
							className="text-xs font-medium text-muted-foreground"
							htmlFor="note-title"
						>
							Title (optional)
						</label>
						<input
							id="note-title"
							className={inputClass}
							placeholder="Brief title (optional)"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<label
							className="text-xs font-medium text-muted-foreground"
							htmlFor="note-text"
						>
							Text
						</label>
						<textarea
							id="note-text"
							className={textareaClass}
							rows={6}
							placeholder="Record a decision, finding, or context…"
							value={text}
							onChange={(e) => setText(e.target.value)}
						/>
					</div>
				</div>
				<SheetFooter className="px-4">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						className="cursor-pointer"
					>
						Cancel
					</Button>
					<Button
						onClick={() => saveMutation.mutate()}
						disabled={saveMutation.isPending || text.trim().length === 0}
						className="cursor-pointer"
					>
						{saveMutation.isPending && (
							<LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						)}
						Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
