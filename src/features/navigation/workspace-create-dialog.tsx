import {
	Flag,
	GitBranch,
	GitPullRequest,
	LoaderCircle,
	Plus,
} from "lucide-react";
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
import { WorkspaceAvatar } from "@/features/navigation/avatar";
import { PullRequestPicker } from "@/features/navigation/pull-request-picker";
import {
	type GithubPullRequestSummary,
	listGithubPullRequestsForRepo,
	listRemoteBranches,
	prefetchRemoteRefs,
	type RepositoryCreateOption,
	resolveGithubPullRequestForRepo,
	type WorkspaceCreationSource,
} from "@/lib/api";
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
	onCreateGoalWorkspace?: (
		repoId: string,
		title: string,
		description: string,
		sourceBranch?: string | null,
	) => Promise<void> | void;
};

export function WorkspaceCreateDialog({
	open,
	onOpenChange,
	repositories,
	creating,
	onCreateWorkspace,
	onCreateGoalWorkspace,
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
	const [goalRepoId, setGoalRepoId] = useState("");
	const [goalBranches, setGoalBranches] = useState<string[]>([]);
	const [goalBranch, setGoalBranch] = useState("");
	const [selectedGoalPrNumber, setSelectedGoalPrNumber] = useState<
		number | null
	>(null);
	const [goalPullRequests, setGoalPullRequests] = useState<
		GithubPullRequestSummary[]
	>([]);
	const [goalLoading, setGoalLoading] = useState(false);
	const [goalError, setGoalError] = useState<string | null>(null);
	const [goalTitle, setGoalTitle] = useState("");
	const [goalDescription, setGoalDescription] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const newRepoListRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		const firstRepoId = repositories[0]?.id ?? "";
		setRemoteRepoId((current) => current || firstRepoId);
		setPrRepoId((current) => current || firstRepoId);
		setGoalRepoId((current) => current || firstRepoId);
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

	useEffect(() => {
		setGoalBranches([]);
		setGoalBranch("");
		setSelectedGoalPrNumber(null);
		setGoalPullRequests([]);
		setGoalError(null);
		if (!open || !goalRepoId) {
			return;
		}
		let canceled = false;
		setGoalLoading(true);
		Promise.allSettled([
			listRemoteBranches({ repoId: goalRepoId }),
			listGithubPullRequestsForRepo(goalRepoId),
		])
			.then(([branchesResult, prsResult]) => {
				if (canceled) {
					return;
				}
				if (branchesResult.status === "fulfilled") {
					setGoalBranches(branchesResult.value);
				}
				if (prsResult.status === "fulfilled") {
					setGoalPullRequests(prsResult.value);
				}
				if (
					branchesResult.status === "rejected" &&
					prsResult.status === "rejected"
				) {
					setGoalError(
						describeUnknownError(
							branchesResult.reason,
							"Unable to load branches or pull requests.",
						),
					);
				}
			})
			.finally(() => {
				if (!canceled) {
					setGoalLoading(false);
				}
			});
		void prefetchRemoteRefs({ repoId: goalRepoId })
			.then(({ fetched }) => {
				if (fetched && !canceled) {
					return listRemoteBranches({ repoId: goalRepoId }).then((branches) => {
						if (!canceled) {
							setGoalBranches(branches);
						}
					});
				}
			})
			.catch(() => {});
		return () => {
			canceled = true;
		};
	}, [goalRepoId, open]);

	useEffect(() => {
		const pr = goalPullRequests.find((item) => item.headBranch === goalBranch);
		setSelectedGoalPrNumber(pr?.number ?? null);
		if (!pr) return;
		setGoalTitle(pr.title);
		setGoalDescription(pr.body);
	}, [goalBranch, goalPullRequests]);

	const goalBranchOptions = Array.from(
		new Set([
			...goalBranches,
			...goalPullRequests
				.map((pr) => pr.headBranch)
				.filter((branch) => branch.trim().length > 0),
		]),
	).sort((left, right) => left.localeCompare(right));

	const selectedGoalPr = goalPullRequests.find(
		(pr) => pr.number === selectedGoalPrNumber,
	);

	const handleSelectGoalPr = useCallback(
		(prNumber: number) => {
			const pr = goalPullRequests.find((item) => item.number === prNumber);
			if (!pr) return;
			setSelectedGoalPrNumber(pr.number);
			setGoalBranch(pr.headBranch);
			setGoalTitle(pr.title);
			setGoalDescription(pr.body);
		},
		[goalPullRequests],
	);

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

	const handleCreateGoal = useCallback(async () => {
		if (
			!goalRepoId ||
			(!goalBranch && !goalTitle.trim()) ||
			(!goalBranch && !goalDescription.trim()) ||
			submitting
		) {
			return;
		}
		setSubmitting(true);
		try {
			await onCreateGoalWorkspace?.(
				goalRepoId,
				goalTitle.trim(),
				goalDescription.trim(),
				goalBranch.trim() || null,
			);
			onOpenChange(false);
		} catch {
			// The sidebar controller owns the destructive error toast. Keep the
			// dialog open so the user remains in the Goal create flow.
		} finally {
			setSubmitting(false);
		}
	}, [
		goalDescription,
		goalBranch,
		goalRepoId,
		goalTitle,
		onCreateGoalWorkspace,
		onOpenChange,
		submitting,
	]);

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
					<TabsList className="grid w-full min-w-0 grid-cols-4">
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
						<TabsTrigger value="goal">
							<Flag className="size-3.5" strokeWidth={2} />
							Goal
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
								id="workspace-create-branch-repo"
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
								id="workspace-create-pr-repo"
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
					<TabsContent value="goal" className="min-h-[340px] min-w-0">
						<div className="flex min-w-0 flex-col gap-3">
							<RepositorySelect
								id="workspace-create-goal-repo"
								label="Repository"
								value={goalRepoId}
								repositories={repositories}
								onChange={setGoalRepoId}
								disabled={busy}
							/>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor="workspace-create-goal-branch"
									className="text-[12px] font-medium tracking-[-0.01em]"
								>
									Branch
								</Label>
								<select
									id="workspace-create-goal-branch"
									value={goalBranch}
									onChange={(event) => setGoalBranch(event.target.value)}
									disabled={busy || goalLoading}
									className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
								>
									<option value="">Create a new Goal branch</option>
									{goalBranchOptions.map((branch) => {
										const pr = goalPullRequests.find(
											(item) => item.headBranch === branch,
										);
										return (
											<option key={branch} value={branch}>
												{pr ? `${branch} — PR #${pr.number}` : branch}
											</option>
										);
									})}
								</select>
								<p className="text-[11px] text-app-muted-foreground">
									Pick an existing branch to make the Goal workspace use it. If
									it has an open PR, the PR title and body fill in
									automatically.
								</p>
							</div>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor="workspace-create-goal-pr"
									className="text-[12px] font-medium tracking-[-0.01em]"
								>
									Pull request
								</Label>
								<select
									id="workspace-create-goal-pr"
									value={selectedGoalPrNumber?.toString() ?? ""}
									onChange={(event) => {
										const value = event.target.value;
										if (!value) {
											setSelectedGoalPrNumber(null);
											setGoalBranch("");
											return;
										}
										handleSelectGoalPr(Number(value));
									}}
									disabled={
										busy || goalLoading || goalPullRequests.length === 0
									}
									className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
								>
									<option value="">
										{goalPullRequests.length === 0
											? "No open pull requests"
											: "Select by pull request"}
									</option>
									{goalPullRequests.map((pr) => (
										<option key={pr.number} value={pr.number.toString()}>
											#{pr.number} {pr.title} — {pr.headBranch} →{" "}
											{pr.baseBranch}
										</option>
									))}
								</select>
								<p className="text-[11px] text-app-muted-foreground">
									{selectedGoalPr
										? `Using PR #${selectedGoalPr.number}: ${selectedGoalPr.url}`
										: "Select a PR to reverse-fill its branch and Goal details."}
								</p>
							</div>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor="workspace-create-goal-title"
									className="text-[12px] font-medium tracking-[-0.01em]"
								>
									Goal title
								</Label>
								<Input
									id="workspace-create-goal-title"
									value={goalTitle}
									onChange={(event) => setGoalTitle(event.target.value)}
									placeholder="Desktop companion app"
									disabled={busy}
									className="h-8 text-[13px] md:text-[13px]"
								/>
							</div>
							<div className="flex flex-col gap-1">
								<Label
									htmlFor="workspace-create-goal-description"
									className="text-[12px] font-medium tracking-[-0.01em]"
								>
									Goal description
								</Label>
								<textarea
									id="workspace-create-goal-description"
									value={goalDescription}
									onChange={(event) => setGoalDescription(event.target.value)}
									placeholder="Describe the goal, acceptance criteria, and how child PRs should stack."
									disabled={busy}
									className="min-h-28 resize-none rounded-md border border-input bg-background px-2 py-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
								/>
							</div>
							<StatusText loading={goalLoading} error={goalError} />
							<div className="flex justify-end">
								<Button
									size="sm"
									disabled={
										!goalRepoId ||
										(!goalBranch && !goalTitle.trim()) ||
										(!goalBranch && !goalDescription.trim()) ||
										busy
									}
									onClick={() => void handleCreateGoal()}
								>
									{busy ? <LoaderCircle className="animate-spin" /> : null}
									Create Goal
								</Button>
							</div>
						</div>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
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
	id,
	label,
	value,
	repositories,
	onChange,
	disabled,
}: {
	id: string;
	label: string;
	value: string;
	repositories: RepositoryCreateOption[];
	onChange: (repoId: string) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label
				htmlFor={id}
				className="text-[12px] font-medium tracking-[-0.01em]"
			>
				{label}
			</Label>
			<select
				id={id}
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
