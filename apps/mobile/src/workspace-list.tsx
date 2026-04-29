import { Circle } from "lucide-react";
import type { WorkspaceRow } from "./api";

type WorkspaceListProps = {
	loading: boolean;
	workspaces: WorkspaceRow[];
	onOpenWorkspace: (workspace: WorkspaceRow) => void;
};

export function WorkspaceList({
	loading,
	workspaces,
	onOpenWorkspace,
}: WorkspaceListProps) {
	return (
		<section className="workspace-list">
			{loading && workspaces.length === 0 ? <p>Loading...</p> : null}
			{workspaces.map((workspace) => (
				<button
					type="button"
					key={workspace.id}
					className="workspace-row"
					onClick={() => onOpenWorkspace(workspace)}
				>
					<span className="workspace-dot">
						{workspace.hasUnread ? <Circle fill="currentColor" /> : null}
					</span>
					<span>
						<strong>{workspace.title}</strong>
						<small>
							{workspace.repoName ?? "Repository"} /{" "}
							{workspace.directoryName ?? "workspace"}
						</small>
					</span>
					<em>{workspace.status ?? "progress"}</em>
				</button>
			))}
		</section>
	);
}
