import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type DeleteGoalAction = "free" | "archive";

export interface DeleteGoalDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	goalTitle: string;
	/** Number of child workspaces currently grouped under this goal. */
	childCount: number;
	/**
	 * Called only when the user confirms.
	 *   "free"    → caller should delete only the goal workspace (backend
	 *               nulls out goal_workspace_id on children automatically).
	 *   "archive" → caller should archive every child first, then delete
	 *               the goal workspace.
	 */
	onConfirm: (action: DeleteGoalAction) => void;
}

export function DeleteGoalDialog({
	open,
	onOpenChange,
	goalTitle,
	childCount,
	onConfirm,
}: DeleteGoalDialogProps) {
	const [action, setAction] = useState<DeleteGoalAction>("free");
	const hasChildren = childCount > 0;

	const handleConfirm = () => {
		onConfirm(hasChildren ? action : "free");
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-[360px] gap-0 p-4"
				showCloseButton={false}
			>
				<DialogTitle className="text-[13px] font-semibold">
					Delete goal "{goalTitle}"?
				</DialogTitle>
				<DialogDescription className="mt-1.5 text-[12px] leading-relaxed">
					{hasChildren
						? `This goal has ${childCount} sub-workspace${childCount === 1 ? "" : "s"}. Choose what happens to them.`
						: "This will permanently delete the goal. This cannot be undone."}
				</DialogDescription>

				{hasChildren && (
					<RadioGroup
						className="mt-3 gap-2"
						value={action}
						onValueChange={(v) => setAction(v as DeleteGoalAction)}
					>
						<Label
							htmlFor="delete-goal-free"
							className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm leading-tight transition-colors hover:bg-accent/50"
						>
							<RadioGroupItem
								value="free"
								id="delete-goal-free"
								className="mt-0.5 shrink-0"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-[12.5px] font-medium">
									Free sub-workspaces
								</span>
								<span className="text-[11.5px] text-muted-foreground">
									Sub-workspaces become regular ungrouped workspaces.
								</span>
							</span>
						</Label>
						<Label
							htmlFor="delete-goal-archive"
							className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm leading-tight transition-colors hover:bg-accent/50"
						>
							<RadioGroupItem
								value="archive"
								id="delete-goal-archive"
								className="mt-0.5 shrink-0"
							/>
							<span className="flex flex-col gap-0.5">
								<span className="text-[12.5px] font-medium">
									Archive sub-workspaces
								</span>
								<span className="text-[11.5px] text-muted-foreground">
									{childCount} sub-workspace{childCount === 1 ? "" : "s"} will
									be archived before the goal is deleted.
								</span>
							</span>
						</Label>
					</RadioGroup>
				)}

				<div className="mt-3 flex justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						size="sm"
						className="cursor-pointer"
						onClick={handleConfirm}
					>
						Delete goal
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
