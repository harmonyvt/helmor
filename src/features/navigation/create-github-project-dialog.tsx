import { open } from "@tauri-apps/plugin-dialog";
import { Globe2, LoaderCircle, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GithubRepositoryVisibility } from "@/lib/api";
import { cn } from "@/lib/utils";
import { describeUnknownError } from "@/lib/workspace-helpers";

type SubmitArgs = {
	projectName: string;
	parentDirectory: string;
	visibility: GithubRepositoryVisibility;
};

type CreateGithubProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultParentDirectory: string | null;
	onSubmit: (args: SubmitArgs) => Promise<void>;
};

export function CreateGithubProjectDialog({
	open: isOpen,
	onOpenChange,
	defaultParentDirectory,
	onSubmit,
}: CreateGithubProjectDialogProps) {
	const [projectName, setProjectName] = useState("");
	const [parentDirectory, setParentDirectory] = useState("");
	const [visibility, setVisibility] =
		useState<GithubRepositoryVisibility>("private");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const parentDirectoryTouchedRef = useRef(false);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setIsSubmitting(false);
		setErrorMessage(null);
		if (!parentDirectoryTouchedRef.current) {
			setParentDirectory(defaultParentDirectory ?? "");
		}
	}, [isOpen, defaultParentDirectory]);

	const handleBrowse = useCallback(async () => {
		try {
			const selection = await open({
				directory: true,
				multiple: false,
				defaultPath: parentDirectory || defaultParentDirectory || undefined,
			});
			const selected = Array.isArray(selection) ? selection[0] : selection;
			if (selected) {
				parentDirectoryTouchedRef.current = true;
				setParentDirectory(selected);
			}
		} catch (error) {
			setErrorMessage(
				describeUnknownError(error, "Unable to open the folder picker."),
			);
		}
	}, [defaultParentDirectory, parentDirectory]);

	const trimmedProjectName = projectName.trim();
	const trimmedParentDirectory = parentDirectory.trim();
	const canSubmit =
		trimmedProjectName.length > 0 &&
		trimmedParentDirectory.length > 0 &&
		!isSubmitting;

	const handleSubmit = useCallback(async () => {
		if (!canSubmit) {
			return;
		}
		setIsSubmitting(true);
		setErrorMessage(null);
		try {
			await onSubmit({
				projectName: trimmedProjectName,
				parentDirectory: trimmedParentDirectory,
				visibility,
			});
			setProjectName("");
			setParentDirectory("");
			setVisibility("private");
			parentDirectoryTouchedRef.current = false;
			onOpenChange(false);
		} catch (error) {
			setErrorMessage(
				describeUnknownError(error, "Unable to create GitHub project."),
			);
		} finally {
			setIsSubmitting(false);
		}
	}, [
		canSubmit,
		onOpenChange,
		onSubmit,
		trimmedParentDirectory,
		trimmedProjectName,
		visibility,
	]);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(nextOpen) => {
				if (isSubmitting && !nextOpen) {
					return;
				}
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="gap-3 p-4 sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="text-[13px] font-medium tracking-[-0.01em]">
						New GitHub project
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void handleSubmit();
					}}
					className="flex flex-col gap-3"
				>
					<div className="flex flex-col gap-1">
						<Label
							htmlFor="github-project-name"
							className="text-[12px] font-medium tracking-[-0.01em]"
						>
							Project name
						</Label>
						<Input
							id="github-project-name"
							type="text"
							value={projectName}
							onChange={(event) => setProjectName(event.target.value)}
							placeholder="my-project"
							autoFocus
							autoComplete="off"
							autoCorrect="off"
							spellCheck={false}
							disabled={isSubmitting}
							className="h-7 text-[13px] md:text-[13px]"
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label
							htmlFor="github-project-location"
							className="text-[12px] font-medium tracking-[-0.01em]"
						>
							Location
						</Label>
						<div className="flex items-center gap-1.5">
							<Input
								id="github-project-location"
								type="text"
								value={parentDirectory}
								onChange={(event) => {
									parentDirectoryTouchedRef.current = true;
									setParentDirectory(event.target.value);
								}}
								autoComplete="off"
								autoCorrect="off"
								spellCheck={false}
								disabled={isSubmitting}
								className="h-7 text-[13px] md:text-[13px]"
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									void handleBrowse();
								}}
								disabled={isSubmitting}
							>
								Browse
							</Button>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<Label className="text-[12px] font-medium tracking-[-0.01em]">
							Visibility
						</Label>
						<div className="grid grid-cols-2 gap-1.5" role="group">
							<VisibilityButton
								value="private"
								selected={visibility === "private"}
								disabled={isSubmitting}
								onSelect={setVisibility}
							/>
							<VisibilityButton
								value="public"
								selected={visibility === "public"}
								disabled={isSubmitting}
								onSelect={setVisibility}
							/>
						</div>
					</div>
					{errorMessage ? (
						<p
							role="alert"
							className="text-destructive text-[12px] leading-snug"
						>
							{errorMessage}
						</p>
					) : null}
					<div className="flex justify-end pt-0.5">
						<Button type="submit" size="sm" disabled={!canSubmit}>
							{isSubmitting ? (
								<>
									<LoaderCircle className="animate-spin" strokeWidth={2.1} />
									Creating
								</>
							) : (
								"Create project"
							)}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function VisibilityButton({
	value,
	selected,
	disabled,
	onSelect,
}: {
	value: GithubRepositoryVisibility;
	selected: boolean;
	disabled: boolean;
	onSelect: (visibility: GithubRepositoryVisibility) => void;
}) {
	const Icon = value === "private" ? Lock : Globe2;
	const label = value === "private" ? "Private" : "Public";

	return (
		<Button
			type="button"
			variant={selected ? "secondary" : "outline"}
			size="sm"
			aria-pressed={selected}
			disabled={disabled}
			onClick={() => onSelect(value)}
			className={cn(
				"h-8 justify-start",
				selected ? "border-primary/30" : "text-muted-foreground",
			)}
		>
			<Icon className="size-3.5" strokeWidth={2} />
			{label}
		</Button>
	);
}
