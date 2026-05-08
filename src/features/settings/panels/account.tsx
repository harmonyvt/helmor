import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { GithubBrandIcon, GitlabBrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	ForgeCliStatus,
	ForgeProvider,
	RepositoryCreateOption,
} from "@/lib/api";
import { forgeCliStatusQueryOptions } from "@/lib/query-client";
import { useForgeCliConnect } from "@/lib/use-forge-cli-connect";
import { SettingsGroup, SettingsRow } from "../components/settings-row";
import { gitlabHostsForRepositories } from "./cli-install-gitlab-hosts";

export function AccountPanel({
	repositories,
}: {
	repositories: RepositoryCreateOption[];
}) {
	const gitlabHosts = useMemo(
		() => gitlabHostsForRepositories(repositories),
		[repositories],
	);

	return (
		<TooltipProvider delayDuration={150}>
			<SettingsGroup>
				<CliIntegrationRow
					provider="github"
					host="github.com"
					title="GitHub CLI integration"
					icon={<GithubBrandIcon size={14} />}
				/>
				{gitlabHosts.length > 0
					? gitlabHosts.map((host) => (
							<CliIntegrationRow
								key={host}
								provider="gitlab"
								host={host}
								title={
									gitlabHosts.length > 1
										? `GitLab CLI integration · ${host}`
										: "GitLab CLI integration"
								}
								icon={<GitlabBrandIcon size={14} className="text-[#FC6D26]" />}
							/>
						))
					: null}
			</SettingsGroup>
		</TooltipProvider>
	);
}

function CliIntegrationRow({
	provider,
	host,
	title,
	icon,
}: {
	provider: ForgeProvider;
	host: string;
	title: string;
	icon: React.ReactNode;
}) {
	const statusQuery = useQuery(forgeCliStatusQueryOptions(provider, host));
	const status = statusQuery.data ?? null;
	const { connect, connecting } = useForgeCliConnect(provider, host);

	const errorMessage =
		status?.status === "error"
			? status.message
			: statusQuery.error instanceof Error
				? statusQuery.error.message
				: null;

	return (
		<CliIntegrationRowView
			title={title}
			icon={icon}
			status={status}
			connecting={connecting}
			isPending={statusQuery.isPending}
			errorMessage={errorMessage}
			onConnect={() => void connect()}
		/>
	);
}

// Pure presentation split out from `CliIntegrationRow`. All right-side variants
// pin to `h-7` so the row height stays constant across Connect / Ready / Error
// states (otherwise the row visibly jumps when the query resolves).
function CliIntegrationRowView({
	title,
	icon,
	status,
	connecting,
	isPending,
	errorMessage,
	onConnect,
}: {
	title: ReactNode;
	icon: ReactNode;
	status: ForgeCliStatus | null;
	connecting: boolean;
	isPending: boolean;
	errorMessage: string | null;
	onConnect: () => void;
}) {
	const isReady = status?.status === "ready";
	return (
		<SettingsRow
			title={
				<span className="flex items-center gap-1.5">
					{icon}
					<span>{title}</span>
				</span>
			}
		>
			{isReady && status ? (
				<div className="inline-flex h-7 items-center gap-1.5 text-[12px] text-muted-foreground">
					<CheckCircle2 className="size-3.5 text-green-500" strokeWidth={2} />
					<span className="truncate">{status.login}</span>
				</div>
			) : errorMessage ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="CLI status error"
							className="inline-flex h-7 cursor-default items-center justify-center text-destructive"
						>
							<CircleAlert className="size-4" strokeWidth={2.2} />
						</button>
					</TooltipTrigger>
					<TooltipContent
						side="top"
						className="max-w-xs whitespace-normal text-[11px] leading-snug"
					>
						{errorMessage}
					</TooltipContent>
				</Tooltip>
			) : (
				<Button
					variant="outline"
					size="sm"
					onClick={onConnect}
					disabled={connecting || isPending}
				>
					{connecting ? <Loader2 className="size-3.5 animate-spin" /> : null}
					Connect
				</Button>
			)}
		</SettingsRow>
	);
}
