import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionsSection } from "./sections/actions";
import { ChangesSection } from "./sections/changes";
import { RunTab } from "./sections/run";

// ── Mobile Inspector View ─────────────────────────────────────────────────────
//
// Full-screen inspector shown on the "Inspector" tab of the mobile app.
// Three sub-tabs: Changes, Actions, Run.
//
// Intentionally does NOT import from layout.tsx — no hover-to-zoom, no resize
// handles, no desktop InspectorTabsSection machinery.

interface MobileInspectorViewProps {
	selectedWorkspaceId: string | null;
}

// A height large enough that ChangesSection's overflow-hidden section never
// clips content — the parent TabsContent's overflow-y-auto handles scrolling.
const FILL_HEIGHT = 9999;

// No-op for editor callbacks — mobile view has no Monaco file editor surface.
function noop() {}

export default function MobileInspectorView({
	selectedWorkspaceId,
}: MobileInspectorViewProps) {
	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			{/* Header */}
			<div className="flex h-12 shrink-0 items-center border-b border-border px-4">
				<span className="text-sm font-semibold">Inspector</span>
			</div>

			{selectedWorkspaceId ? (
				<Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
					{/* Tab list */}
					<div className="shrink-0 border-b border-border px-4">
						<TabsList variant="line" className="gap-4">
							<TabsTrigger value="changes" className="cursor-pointer">
								Changes
							</TabsTrigger>
							<TabsTrigger value="actions" className="cursor-pointer">
								Terminal
							</TabsTrigger>
							<TabsTrigger value="run" className="cursor-pointer">
								Run
							</TabsTrigger>
						</TabsList>
					</div>

					{/* Changes tab */}
					<TabsContent value="changes" className="flex-1 overflow-y-auto">
						<div className="min-h-[44px]">
							<ChangesSection
								bodyHeight={FILL_HEIGHT}
								workspaceId={selectedWorkspaceId}
								workspaceRootPath={null}
								workspaceTargetBranch={null}
								changes={[]}
								editorMode={false}
								activeEditorPath={null}
								onOpenEditorFile={noop}
								flashingPaths={new Set()}
								changeRequest={null}
							/>
						</div>
					</TabsContent>

					{/* Actions tab */}
					<TabsContent value="actions" className="flex-1 overflow-y-auto">
						<div className="w-full px-0">
							<ActionsSection
								workspaceId={selectedWorkspaceId}
								workspaceState={null}
								repoId={null}
								workspaceRemote={null}
								bodyHeight={FILL_HEIGHT}
								expanded={true}
								changeRequest={null}
							/>
						</div>
					</TabsContent>

					{/* Run tab */}
					<TabsContent value="run" className="flex-1 overflow-y-auto">
						<RunTab
							repoId={null}
							workspaceId={selectedWorkspaceId}
							runScript={null}
							isActive={true}
							onOpenSettings={noop}
						/>
					</TabsContent>
				</Tabs>
			) : (
				<div className="flex flex-1 items-center justify-center p-8">
					<p className="text-center text-sm text-muted-foreground">
						Select a workspace to see its changes.
					</p>
				</div>
			)}
		</div>
	);
}
