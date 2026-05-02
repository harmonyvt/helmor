import { ArrowLeft, LogOut, RefreshCw } from "lucide-react";

type TopbarProps = {
	view: "workspaces" | "thread";
	workspaceTitle?: string | null;
	sessionTitle?: string | null;
	onBackOrRefresh: () => void;
	onSignOut: () => void;
};

export function Topbar({
	view,
	workspaceTitle,
	sessionTitle,
	onBackOrRefresh,
	onSignOut,
}: TopbarProps) {
	return (
		<header className="topbar">
			<button type="button" className="icon-button" onClick={onBackOrRefresh}>
				{view === "thread" ? <ArrowLeft /> : <RefreshCw />}
			</button>
			<div>
				<p>{view === "thread" ? workspaceTitle : "Helmor"}</p>
				<span>{view === "thread" ? sessionTitle : "Mobile"}</span>
			</div>
			<button type="button" className="icon-button" onClick={onSignOut}>
				<LogOut />
			</button>
		</header>
	);
}
