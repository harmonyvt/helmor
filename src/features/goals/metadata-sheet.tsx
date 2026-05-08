import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type GoalMetaSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTitle: string;
	initialDescription: string;
	onSave: (title: string, description: string) => Promise<void>;
};

export function GoalMetaSheet({
	open,
	onOpenChange,
	initialTitle,
	initialDescription,
	onSave,
}: GoalMetaSheetProps) {
	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState(initialDescription);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setTitle(initialTitle);
		setDescription(initialDescription);
	}, [open, initialTitle, initialDescription]);

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(title, description);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="flex w-full max-w-md flex-col gap-0 p-0"
			>
				<SheetHeader className="border-b border-border/70 px-5 py-4">
					<SheetTitle>Goal details</SheetTitle>
					<SheetDescription>
						Set a title and description for this goal workspace. The Pi AI agent
						uses these to stay focused on what you're building.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
					<div className="space-y-1.5">
						<label
							htmlFor="goal-title"
							className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground"
						>
							Title
						</label>
						<input
							id="goal-title"
							type="text"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="e.g. Build the authentication system"
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="goal-description"
							className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground"
						>
							Description
						</label>
						<Textarea
							id="goal-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Describe what this goal is about, what success looks like, and any constraints or context the AI should know..."
							className="min-h-[120px] resize-y text-sm"
						/>
					</div>
				</div>

				<SheetFooter className="border-t border-border/70 px-5 py-4">
					<Button
						variant="outline"
						className="cursor-pointer"
						onClick={() => onOpenChange(false)}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						className="cursor-pointer"
						onClick={handleSave}
						disabled={saving}
					>
						{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
						Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
