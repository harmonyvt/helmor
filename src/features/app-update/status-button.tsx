import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	getLocalAppInstallSnapshot,
	startLocalAppInstall,
	startLocalAppUpdateMonitor,
	subscribeLocalAppInstall,
} from "@/features/settings/panels/local-app-update-store";
import { restartApp } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";

export function LocalAppUpdateStatusButton() {
	const state = useSyncExternalStore(
		subscribeLocalAppInstall,
		getLocalAppInstallSnapshot,
		getLocalAppInstallSnapshot,
	);
	const pushToast = useWorkspaceToast();

	useEffect(() => startLocalAppUpdateMonitor(), []);

	const installing = state.phase === "running";
	const restartRequired =
		state.phase === "succeeded" && state.result?.restartRequired;
	const updateAvailable =
		state.updateStatus?.updateAvailable || state.phase === "failed";
	const visible = installing || restartRequired || updateAvailable;

	const handleClick = useCallback(async () => {
		if (installing) return;
		if (restartRequired) {
			try {
				await restartApp(true);
			} catch (error) {
				pushToast(
					error instanceof Error ? error.message : String(error),
					"Unable to restart Helmor",
					"destructive",
				);
			}
			return;
		}

		try {
			await startLocalAppInstall();
		} catch (error) {
			pushToast(
				error instanceof Error ? error.message : String(error),
				"Unable to install Helmor update",
				"destructive",
			);
		}
	}, [installing, pushToast, restartRequired]);

	if (!visible) return null;

	const label = installing
		? "Installing Helmor update"
		: restartRequired
			? "Restart Helmor"
			: state.updateStatus?.behindCount
				? `Install Helmor update (${state.updateStatus.behindCount} behind)`
				: "Install Helmor update";
	const Icon = installing ? Loader2 : restartRequired ? RefreshCw : Download;

	return (
		<div className="fixed left-[96px] top-[6px] z-50 hidden lg:block">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						aria-label={label}
						variant={restartRequired ? "default" : "outline"}
						size="icon-xs"
						disabled={installing}
						onClick={handleClick}
						className={cn(
							"border-app-warning/45 bg-app-warning/10 text-app-warning shadow-sm hover:bg-app-warning/15 hover:text-app-warning",
							restartRequired &&
								"border-app-success/40 bg-app-success text-app-success-foreground hover:bg-app-success/90 hover:text-app-success-foreground",
							installing && "opacity-100",
						)}
					>
						<Icon
							className={cn("size-3.5", installing && "animate-spin")}
							strokeWidth={2}
						/>
					</Button>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					sideOffset={5}
					className="max-w-[260px] rounded-md px-2 py-1.5 text-[12px] leading-snug"
				>
					{tooltipLabel({
						installing,
						restartRequired: Boolean(restartRequired),
						behindCount: state.updateStatus?.behindCount ?? 0,
						upstream: state.updateStatus?.upstream ?? null,
					})}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function tooltipLabel({
	installing,
	restartRequired,
	behindCount,
	upstream,
}: {
	installing: boolean;
	restartRequired: boolean;
	behindCount: number;
	upstream: string | null;
}) {
	if (installing) return "Installing the latest Helmor build.";
	if (restartRequired) return "Restart Helmor to use the installed update.";
	if (behindCount > 0) {
		const target = upstream ? ` from ${upstream}` : "";
		return `${behindCount} ${behindCount === 1 ? "commit" : "commits"} behind${target}.`;
	}
	return "Install Helmor update.";
}
