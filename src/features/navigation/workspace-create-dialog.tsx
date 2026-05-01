import { GitBranch, GitPullRequest, LoaderCircle, Plus } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceAvatar } from "@/features/navigation/avatar";
import {
	type GithubPullRequestSummary,
	listGithubPullRequestsForRepo,
	listRemoteBranches,
	prefetchRemoteRefs,
	type RepositoryCreateOption,
	resolveGithubPullRequestForRepo,
	type WorkspaceCreationSource,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { describeUnknownError } from "@/lib/workspace-helpers";

type WorkspaceCreateDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	repositories: RepositoryCreateOption[];
	creating: boolean;
	onCreateWorkspace: (
		repoId: string,
		source?: WorkspaceCreationSource,
	) => Promise<void> | void;
};

export function WorkspaceCreateDialog({
	open,
	onOpenChange,
	repositories,
	creating,
	onCreateWorkspace,
}: WorkspaceCreateDialogProps) {
	const [tab, setTab] = useState("new");
	const [remoteRepoId, setRemoteRepoId] = useState("");
	const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
	const [remoteBranch, setRemoteBranch] = useState("");
	const [remoteLoading, setRemoteLoading] = useState(false);
	const [remoteError, setRemoteError] = useState<string | null>(null);
	const [prRepoId, setPrRepoId] = useState("");
	const [pullRequests, setPullRequests] = useState<GithubPullRequestSummary[]>(
		[],
	);
	const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
	const [prInput, setPrInput] = useState("");
	const [prLoading, setPrLoading] = useState(false);
	const [prError, setPrError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const newRepoListRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const firstRepoId = repositories[0]?.id ?? "";
		setRemoteRepoId((current) => current || firstRepoId);
		setPrRepoId((current) => current || firstRepoId);
		setRemoteError(null);
		setPrError(null);
	}, [open, repositories]);

	useEffect(() => {
		if (!open || tab !== "new") {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			newRepoListRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open, tab]);

	useEffect(() => {
		setRemoteBranches([]);
		setRemoteBranch("");
		setRemoteError(null);
		if (!open || !remoteRepoId) {
			return;
		}
		let canceled = false;
		setRemoteLoading(true);
		void listRemoteBranches({ repoId: remoteRepoId })
			.then((branches) => {
				if (!canceled) {
					setRemoteBranches(branches);
					setRemoteBranch(branches[0] ?? "");
				}
			})
			.catch((error) => {
				if (!canceled) {
					setRemoteError(
						describeUnknownError(error, "Unable to load branches."),
					);
				}
			})
			.finally(() => {
				if (!canceled) {
					setRemoteLoading(false);
				}
			});
		void prefetchRemoteRefs({ repoId: remoteRepoId })
			.then(({ fetched }) => {
				if (fetched && !canceled) {
					return listRemoteBranches({ repoId: remoteRepoId }).then(
						(branches) => {
							if (!canceled) {
								setRemoteBranches(branches);
								setRemoteBranch((current) => current || branches[0] || "");
							}
						},
					);
				}
			})
			.catch(() => {});
		return () => {
			canceled = true;
		};
	}, [open, remoteRepoId]);

	useEffect(() => {
		setPullRequests([]);
		setSelectedPrNumber(null);
		setPrError(null);
		if (!open || !prRepoId) {
			return;
		}
		let canceled = false;
		setPrLoading(true);
		void listGithubPullRequestsForRepo(prRepoId)
			.then((items) => {
				if (!canceled) {
					setPullRequests(items);
					setSelectedPrNumber(items[0]?.number ?? null);
				}
			})
			.catch((error) => {
				if (!canceled) {
					setPrError(
						describeUnknownError(error, "Unable to load pull requests."),
					);
				}
			})
			.finally(() => {
				if (!canceled) {
					setPrLoading(false);
				}
			});
		return () => {
			canceled = true;
		};
	}, [open, prRepoId]);

	// Derived busy flag — true while either the async handshake (Phase 1 /
	// GitHub API) is in-flight from this dialog OR the parent controller has a
	// creation already running (Phase 2 / git worktree).
	const busy = submitting || creating;

	const handleCreate = useCallback(
		async (repoId: string, source?: WorkspaceCreationSource) => {
			if (submitting) return;
			setSubmitting(true);
			try {
				if (source) {
					await onCreateWorkspace(repoId, source);
				} else {
					await onCreateWorkspace(repoId);
				}
			} finally {
				setSubmitting(false);
				onOpenChange(false);
			}
		},
		[onCreateWorkspace, onOpenChange, submitting],
	);

	const handleResolvePr = useCallback(async () => {
		if (!prRepoId || !prInput.trim()) {
			return;
		}
		setPrLoading(true);
		setPrError(null);
		try {
			const pr = await resolveGithubPullRequestForRepo(prRepoId, prInput);
			setPullRequests((current) => {
				if (current.some((item) => item.number === pr.number)) {
					return current;
				}
				return [pr, ...current];
			});
			setSelectedPrNumber(pr.number);
		} catch (error) {
			setPrError(
				describeUnknownError(error, "Unable to resolve pull request."),
			);
		} finally {
			setPrLoading(false);
		}
	}, [prInput, prRepoId]);

	return (
		<Dialog
			modal={false}
			open={open}
			onOpenChange={(next) => !busy && onOpenChange(next)}
		>
			<DialogContent className="min-w-0 gap-3 overflow-hidden p-4 sm:max-w-[680px]">
				<DialogHeader className="min-w-0">
					<DialogTitle className="text-[13px] font-medium tracking-[-0.01em]">
						Create workspace
					</DialogTitle>
					<DialogDescription className="sr-only">
						Create a workspace from a new branch, remote branch, or GitHub pull
						request.
					</DialogDescription>
				</DialogHeader>
				<Tabs value={tab} onValueChange={setTab} className="min-w-0 w-full">
					<TabsList className="grid w-full min-w-0 grid-cols-3">
						<TabsTrigger value="new">
							<Plus className="size-3.5" strokeWidth={2} />
							New
						</TabsTrigger>
						<TabsTrigger value="branch">
							<GitBranch className="size-3.5" strokeWidth={2} />
							Branch
						</TabsTrigger>
						<TabsTrigger value="pr">
							<GitPullRequest className="size-3.5" strokeWidth={2} />
							PR
						</TabsTrigger>
					</TabsList>
					<TabsContent value="new" className="min-h-[340px] min-w-0">
						<RepositoryList
							repositories={repositories}
							creating={busy}
							listRef={newRepoListRef}
							onSelect={(repoId) => handleCreate(repoId)}
						/>
					</TabsContent>
					<TabsContent value="branch" className="min-h-[340px] min-w-0">
						<div className="flex min-w-0 flex-col gap-3">
							<RepositorySelect
								label="Repository"
								value={remoteRepoId}
								repositories={repositories}
								onChange={setRemoteRepoId}
								disabled={busy}
							/>
							<div className="flex flex-col gap-1">
								<Label className="text-[12px] font-medium tracking-[-0.01em]">
									Remote branch
								</Label>
								<select
									value={remoteBranch}
									onChange={(event) => setRemoteBranch(event.target.value)}
									disabled={
										busy || remoteLoading || remoteBranches.length === 0
									}
									className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
								>
									{remoteBranches.map((branch) => (
										<option key={branch} value={branch}>
											{branch}
										</option>
									))}
								</select>
							</div>
							<StatusText loading={remoteLoading} error={remoteError} />
							<div className="flex justify-end">
								<Button
									size="sm"
									disabled={!remoteRepoId || !remoteBranch || busy}
									onClick={() =>
										handleCreate(remoteRepoId, {
											type: "remoteBranch",
											branch: remoteBranch,
										})
									}
								>
									{busy ? <LoaderCircle className="animate-spin" /> : null}
									Create workspace
								</Button>
							</div>
						</div>
					</TabsContent>
					<TabsContent value="pr" className="min-h-[340px] min-w-0">
						<div className="flex min-w-0 flex-col gap-3">
							<RepositorySelect
								label="Repository"
								value={prRepoId}
								repositories={repositories}
								onChange={setPrRepoId}
								disabled={busy}
							/>
							<div className="flex min-w-0 items-end gap-2">
								<div className="min-w-0 flex-1">
									<Label
										htmlFor="workspace-create-pr-input"
										className="text-[12px] font-medium tracking-[-0.01em]"
									>
										PR URL or number
									</Label>
									<Input
										id="workspace-create-pr-input"
										value={prInput}
										onChange={(event) => setPrInput(event.target.value)}
										placeholder="42 or https://github.com/owner/repo/pull/42"
										disabled={busy || prLoading}
										className="mt-1 h-8 text-[13px] md:text-[13px]"
									/>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!prRepoId || !prInput.trim() || busy || prLoading}
									onClick={() => void handleResolvePr()}
								>
									{prLoading ? (
										<LoaderCircle className="animate-spin" strokeWidth={2.1} />
									) : null}
									Resolve
								</Button>
							</div>
							<PullRequestPicker
								pullRequests={pullRequests}
								loading={prLoading}
								selectedPrNumber={selectedPrNumber}
								creating={busy}
								onSelect={setSelectedPrNumber}
							/>
							<StatusText loading={false} error={prError} />
							<div className="flex justify-end">
								<Button
									size="sm"
									disabled={!prRepoId || !selectedPrNumber || busy}
									onClick={() =>
										selectedPrNumber
											? handleCreate(prRepoId, {
													type: "githubPullRequest",
													number: selectedPrNumber,
												})
											: undefined
									}
								>
									{busy ? <LoaderCircle className="animate-spin" /> : null}
									Create workspace
								</Button>
							</div>
						</div>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

function PullRequestPicker({
	pullRequests,
	loading,
	selectedPrNumber,
	creating,
	onSelect,
}: {
	pullRequests: GithubPullRequestSummary[];
	loading: boolean;
	selectedPrNumber: number | null;
	creating: boolean;
	onSelect: (number: number) => void;
}) {
	if (pullRequests.length === 0 && !loading) {
		return (
			<div className="min-h-28 min-w-0 rounded-md border border-app-border/50 px-3 py-8 text-center text-[12px] text-muted-foreground">
				No open pull requests.
			</div>
		);
	}

	if (pullRequests.length === 0 && loading) {
		return (
			<div className="flex min-h-28 min-w-0 items-center justify-center gap-2 rounded-md border border-app-border/50 px-3 py-8 text-[12px] text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				Loading pull requests...
			</div>
		);
	}

	return (
		<div className="min-w-0 overflow-hidden rounded-md border border-app-border/50">
			<div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,35%)] gap-3 border-app-border/50 border-b bg-muted/40 px-2.5 py-1.5 text-[10.5px] font-medium text-muted-foreground uppercase tracking-[0.02em]">
				<span className="min-w-0 truncate">Pull request</span>
				<span className="min-w-0 truncate">Branch</span>
			</div>
			<TooltipProvider delayDuration={400}>
				<div
					aria-label="Open pull requests"
					className="max-h-[260px] min-w-0 overflow-y-auto p-1"
				>
					{pullRequests.map((pr) => (
						<Tooltip key={pr.number}>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-pressed={selectedPrNumber === pr.number}
									className={cn(
										"grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_minmax(7rem,35%)] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
										selectedPrNumber === pr.number &&
											"bg-accent text-foreground",
									)}
									onClick={() => onSelect(pr.number)}
									disabled={creating}
								>
									<span className="min-w-0 truncate">
										#{pr.number} {pr.title}
									</span>
									<span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
										{pr.headBranch}
									</span>
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="top"
								align="start"
								className="max-w-sm flex-col items-start gap-1"
							>
								<p className="font-medium leading-snug">
									#{pr.number} {pr.title}
								</p>
								<p className="font-mono text-[10px] opacity-70">
									{pr.headBranch} -&gt; {pr.baseBranch}
								</p>
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>
		</div>
	);
}

function RepositoryList({
	repositories,
	creating,
	listRef,
	onSelect,
}: {
	repositories: RepositoryCreateOption[];
	creating: boolean;
	listRef?: RefObject<HTMLDivElement | null>;
	onSelect: (repoId: string) => void;
}) {
	return (
		<Command className="rounded-md border border-app-border/50 bg-transparent">
			<CommandList
				ref={listRef}
				tabIndex={0}
				className="max-h-[320px] outline-none"
			>
				<CommandEmpty>No repositories found.</CommandEmpty>
				{repositories.map((repository) => (
					<CommandItem
						key={repository.id}
						value={`${repository.name} ${repository.defaultBranch ?? ""}`}
						disabled={creating}
						onSelect={() => onSelect(repository.id)}
						className="rounded-lg [&>svg:last-child]:hidden"
					>
						<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-2">
								<WorkspaceAvatar
									repoIconSrc={repository.repoIconSrc}
									repoInitials={repository.repoInitials}
									repoName={repository.name}
									title={repository.name}
									className="size-5 rounded-md"
									fallbackClassName="text-[8px]"
								/>
								<span className="truncate font-medium">{repository.name}</span>
							</div>
							{repository.defaultBranch ? (
								<span className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
									{repository.remote ?? "origin"}/
									{repository.defaultBranch.toLowerCase()}
								</span>
							) : null}
						</div>
					</CommandItem>
				))}
			</CommandList>
		</Command>
	);
}

function RepositorySelect({
	label,
	value,
	repositories,
	onChange,
	disabled,
}: {
	label: string;
	value: string;
	repositories: RepositoryCreateOption[];
	onChange: (repoId: string) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label className="text-[12px] font-medium tracking-[-0.01em]">
				{label}
			</Label>
			<select
				value={value}
				onChange={(event) => onChange(event.target.value)}
				disabled={disabled}
				className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
			>
				{repositories.map((repository) => (
					<option key={repository.id} value={repository.id}>
						{repository.name}
					</option>
				))}
			</select>
		</div>
	);
}

function StatusText({
	loading,
	error,
}: {
	loading: boolean;
	error: string | null;
}) {
	if (error) {
		return (
			<p role="alert" className="text-destructive text-[12px] leading-snug">
				{error}
			</p>
		);
	}
	if (loading) {
		return (
			<p className="flex items-center gap-2 text-[12px] text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				Loading...
			</p>
		);
	}
	return null;
}
