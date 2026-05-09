import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { WorkspaceInspectorSidebar } from "@/features/inspector";
import { cn } from "@/lib/utils";

interface InspectorSheetProps {
	open: boolean;
	onClose: () => void;
	workspaceId: string;
	wideMode: boolean;
}

function noop() {}

function InspectorContent({ workspaceId }: { workspaceId: string }) {
	return (
		<div className="flex-1 min-h-0 overflow-hidden h-full">
			<WorkspaceInspectorSidebar
				workspaceId={workspaceId}
				editorMode={false}
				onOpenEditorFile={noop}
			/>
		</div>
	);
}

export function InspectorSheet({
	open,
	onClose,
	workspaceId,
	wideMode,
}: InspectorSheetProps) {
	if (!workspaceId) return null;

	if (wideMode) {
		return (
			<div
				className={cn(
					"h-full shrink-0 border-l border-border bg-sidebar overflow-hidden transition-all duration-200",
					open ? "w-[280px] opacity-100" : "w-0 opacity-0",
				)}
			>
				{open && <InspectorContent workspaceId={workspaceId} />}
			</div>
		);
	}

	return (
		<Sheet open={open} onOpenChange={(v) => !v && onClose()}>
			<SheetContent
				side="right"
				className="w-[300px] sm:max-w-[300px] p-0 flex flex-col"
				showCloseButton={false}
			>
				<SheetTitle className="sr-only">Inspector</SheetTitle>
				<InspectorContent workspaceId={workspaceId} />
			</SheetContent>
		</Sheet>
	);
}
