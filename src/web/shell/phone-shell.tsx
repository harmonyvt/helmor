import { useEffect, useState } from "react";
import WorkspaceChatPage from "../pages/workspace-chat-page";
import WorkspaceListPage from "../pages/workspace-list-page";
import type { WebPage, WebShellProps } from "../types";

export default function PhoneShell({
	selectedWorkspaceId,
	selectedSessionId,
	onWorkspaceSelect,
	onSessionSelect,
	onBackToList,
}: WebShellProps) {
	const [page, setPage] = useState<WebPage>(() =>
		selectedWorkspaceId ? "chat" : "list",
	);

	useEffect(() => {
		setPage(selectedWorkspaceId ? "chat" : "list");
	}, [selectedWorkspaceId]);

	const handleWorkspaceSelect = (id: string) => {
		onWorkspaceSelect(id);
		setPage("chat");
	};

	const handleBack = () => {
		onBackToList();
		setPage("list");
	};

	const listTranslate = page === "chat" ? "translateX(-30%)" : "translateX(0)";
	const chatTranslate = page === "chat" ? "translateX(0)" : "translateX(100%)";

	const transition = "transform 260ms cubic-bezier(0.16, 1, 0.3, 1)";

	return (
		<div className="relative h-dvh w-full overflow-hidden bg-background">
			{/* List panel */}
			<div
				className="absolute inset-0"
				style={{ transform: listTranslate, transition }}
			>
				<WorkspaceListPage
					selectedWorkspaceId={selectedWorkspaceId}
					onWorkspaceSelect={handleWorkspaceSelect}
				/>
			</div>
			{/* Chat panel */}
			<div
				className="absolute inset-0"
				style={{ transform: chatTranslate, transition }}
			>
				<WorkspaceChatPage
					workspaceId={selectedWorkspaceId}
					sessionId={selectedSessionId}
					onSessionSelect={onSessionSelect}
					onBack={handleBack}
				/>
			</div>
		</div>
	);
}
