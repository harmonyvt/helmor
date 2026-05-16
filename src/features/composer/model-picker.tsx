import { Check, ChevronDown, Plus, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelIcon } from "@/components/model-icon";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	getCodexProfileKey,
	getCodexProfileLabel,
	getPiModelProviderKey,
	getPiModelProviderLabel,
} from "@/lib/agent-models";
import type { AgentModelOption, AgentModelSection } from "@/lib/api";
import { cn } from "@/lib/utils";

function logModelPickerDebug(
	event: string,
	payload?: Record<string, unknown>,
): void {
	console.info(`[model-picker-debug] ${event}`, payload ?? {});
}

// ---------------------------------------------------------------------------
// Grouping helper (Pi models split by provider key; Codex models split by
// config profile when profile-backed options are present)
// ---------------------------------------------------------------------------

function groupModelSectionForPicker(
	section: AgentModelSection,
): AgentModelSection[] {
	if (
		section.id === "codex" &&
		section.options.some((option) => option.codexProfile)
	) {
		const groupedOptions = new Map<string, AgentModelOption[]>();
		for (const option of section.options) {
			const profileKey = getCodexProfileKey(option);
			const existing = groupedOptions.get(profileKey);
			if (existing) {
				existing.push(option);
			} else {
				groupedOptions.set(profileKey, [option]);
			}
		}
		return Array.from(groupedOptions, ([profileKey, options]) => ({
			...section,
			id: `${section.id}:${profileKey}`,
			label: `${section.label} · ${getCodexProfileLabel(profileKey)}`,
			options,
		}));
	}
	if (section.id !== "pi") return [section];
	const groupedOptions = new Map<string, AgentModelOption[]>();
	for (const option of section.options) {
		const providerKey = getPiModelProviderKey(option);
		const existing = groupedOptions.get(providerKey);
		if (existing) {
			existing.push(option);
		} else {
			groupedOptions.set(providerKey, [option]);
		}
	}
	return Array.from(groupedOptions, ([providerKey, options]) => ({
		...section,
		id: `${section.id}:${providerKey}`,
		label: `${section.label} · ${getPiModelProviderLabel(providerKey)}`,
		options,
	}));
}

/** Strip a redundant provider prefix from the model label when it's already
 *  expressed by the section header.  e.g. if section is "Pi · xAI" and the
 *  model label is "Pi · xAI: Grok 4", return "Grok 4". */
function trimSectionPrefix(label: string, sectionLabel: string): string {
	const prefix = `${sectionLabel}: `;
	return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModelPickerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	disabled?: boolean;
	selectedModel: AgentModelOption | null;
	selectedModelId: string | null;
	modelSections: AgentModelSection[];
	hasConfiguredClaudeProviderModels: boolean;
	favoriteModelIds: string[];
	onSelectModel: (modelId: string) => void;
	onToggleFavorite: (modelId: string) => void;
	onOpenModelSettings: () => void;
	triggerClassName: string;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ModelPicker({
	open,
	onOpenChange,
	disabled = false,
	selectedModel,
	selectedModelId,
	modelSections,
	hasConfiguredClaudeProviderModels,
	favoriteModelIds,
	onSelectModel,
	onToggleFavorite,
	onOpenModelSettings,
	triggerClassName,
}: ModelPickerProps) {
	const favoriteSet = useMemo(
		() => new Set(favoriteModelIds),
		[favoriteModelIds],
	);

	const displayedSections = useMemo(
		() => modelSections.flatMap(groupModelSectionForPicker),
		[modelSections],
	);
	const sectionCounts = useMemo(
		() =>
			Object.fromEntries(
				modelSections.map((section) => [section.id, section.options.length]),
			),
		[modelSections],
	);
	const displayedSectionCounts = useMemo(
		() =>
			Object.fromEntries(
				displayedSections.map((section) => [
					section.id,
					section.options.length,
				]),
			),
		[displayedSections],
	);

	// Ordered favourite options (preserves cross-section order of appearance)
	const favouriteOptions = useMemo<AgentModelOption[]>(() => {
		if (favoriteSet.size === 0) return [];
		const result: AgentModelOption[] = [];
		for (const section of displayedSections) {
			for (const option of section.options) {
				if (favoriteSet.has(option.id)) result.push(option);
			}
		}
		return result;
	}, [displayedSections, favoriteSet]);

	const hasFavourites = favouriteOptions.length > 0;

	const currentId = selectedModel?.id ?? selectedModelId;

	// Flat ordered list of all options (for keyboard navigation — deduped)
	const allOptions = useMemo<AgentModelOption[]>(() => {
		const seen = new Set<string>();
		const result: AgentModelOption[] = [];
		for (const opt of favouriteOptions) {
			if (!seen.has(opt.id)) {
				seen.add(opt.id);
				result.push(opt);
			}
		}
		for (const section of displayedSections) {
			for (const opt of section.options) {
				if (!seen.has(opt.id)) {
					seen.add(opt.id);
					result.push(opt);
				}
			}
		}
		return result;
	}, [favouriteOptions, displayedSections]);

	// Keyboard: roving focus index
	const [focusIndex, setFocusIndex] = useState(-1);
	const listRef = useRef<HTMLDivElement>(null);

	const handleOpenChange = useCallback(
		(next: boolean) => {
			logModelPickerDebug("open change", {
				next,
				currentId,
				selectedModelId,
				sectionCounts,
				displayedSectionCounts,
				allOptionCount: allOptions.length,
			});
			onOpenChange(next);
		},
		[
			allOptions.length,
			currentId,
			displayedSectionCounts,
			onOpenChange,
			sectionCounts,
			selectedModelId,
		],
	);

	useEffect(() => {
		if (open) {
			const nextIndex = currentId
				? allOptions.findIndex((o) => o.id === currentId)
				: 0;
			logModelPickerDebug("focus reset for open", {
				currentId,
				nextIndex,
				allOptionCount: allOptions.length,
			});
			setFocusIndex(nextIndex);
			window.requestAnimationFrame(() => {
				listRef.current?.focus({ preventScroll: true });
			});
		} else {
			logModelPickerDebug("focus reset for close", {
				previousFocusIndex: focusIndex,
			});
			setFocusIndex(-1);
		}
		// Intentionally narrow: reset only on open/close so background Pi model
		// refreshes do not steal focus while the picker is already open.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		if (!open) return;
		if (focusIndex < 0) return;
		const buttons =
			listRef.current?.querySelectorAll<HTMLButtonElement>("[data-model-row]");
		const target = buttons?.[focusIndex];
		if (!target) return;
		logModelPickerDebug("active row changed", {
			focusIndex,
			rowCount: buttons?.length ?? 0,
			modelId: target.dataset.modelId ?? null,
		});
		target.scrollIntoView({ block: "nearest" });
	}, [focusIndex, open]);

	const handleSelectModel = useCallback(
		(modelId: string) => {
			logModelPickerDebug("select model", {
				modelId,
				currentId,
				allOptionCount: allOptions.length,
			});
			onSelectModel(modelId);
			handleOpenChange(false);
		},
		[allOptions.length, currentId, handleOpenChange, onSelectModel],
	);

	const handleListKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setFocusIndex((i) => Math.min(i + 1, allOptions.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setFocusIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				const modelId = allOptions[focusIndex]?.id;
				if (modelId) handleSelectModel(modelId);
			} else if (e.key === "Escape") {
				handleOpenChange(false);
			}
		},
		[allOptions, focusIndex, handleOpenChange, handleSelectModel],
	);

	const handleOpenSettings = useCallback(() => {
		logModelPickerDebug("open model settings", {
			currentId,
		});
		onOpenModelSettings();
		handleOpenChange(false);
	}, [currentId, handleOpenChange, onOpenModelSettings]);

	const getFlatIndex = useCallback(
		(optionId: string) => allOptions.findIndex((o) => o.id === optionId),
		[allOptions],
	);

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				disabled={disabled}
				className={triggerClassName}
				aria-label={`Model: ${selectedModel?.label ?? "Select model"}`}
			>
				<ModelIcon model={selectedModel} className="size-[13px]" />
				<span>{selectedModel?.label ?? selectedModelId ?? "Select model"}</span>
				<ChevronDown className="size-3 opacity-40" strokeWidth={2} />
			</PopoverTrigger>

			<PopoverContent
				side="top"
				align="start"
				sideOffset={4}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					logModelPickerDebug("open auto focus prevented", {
						currentId,
						focusIndex,
						allOptionCount: allOptions.length,
					});
				}}
				onCloseAutoFocus={() => {
					logModelPickerDebug("close auto focus", {
						currentId,
					});
				}}
				// Override default w-72 / p-2.5 / gap-2.5 from PopoverContent
				className="w-[18rem] gap-0 p-0"
				onKeyDown={handleListKeyDown}
			>
				{/* Scrollable list — capped so the popover never overruns the screen */}
				<div
					ref={listRef}
					role="listbox"
					aria-label="Select model"
					tabIndex={0}
					className="max-h-[min(420px,calc(100vh-140px))] overflow-y-auto p-1"
				>
					{/* Favourites section */}
					{hasFavourites && (
						<>
							<SectionHeader starred>Favourites</SectionHeader>
							{favouriteOptions.map((option) => (
								<ModelRow
									key={`fav:${option.id}`}
									option={option}
									displayLabel={option.label}
									isSelected={option.id === currentId}
									isFavourited
									flatIndex={getFlatIndex(option.id)}
									focusIndex={focusIndex}
									onSelect={handleSelectModel}
									onToggleFavourite={onToggleFavorite}
								/>
							))}
							<Divider />
						</>
					)}

					{/* Provider sections */}
					{displayedSections.map((section, idx) => (
						<div key={section.id}>
							{idx > 0 && <Divider />}
							<SectionHeader>{section.label}</SectionHeader>
							{section.options.map((option) => (
								<ModelRow
									key={option.id}
									option={option}
									displayLabel={trimSectionPrefix(option.label, section.label)}
									isSelected={option.id === currentId}
									isFavourited={favoriteSet.has(option.id)}
									flatIndex={getFlatIndex(option.id)}
									focusIndex={focusIndex}
									onSelect={handleSelectModel}
									onToggleFavourite={onToggleFavorite}
								/>
							))}
							{section.id === "claude" && !hasConfiguredClaudeProviderModels ? (
								<AddCustomModelRow onClick={handleOpenSettings} />
							) : null}
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
	children,
	starred = false,
}: {
	children: React.ReactNode;
	starred?: boolean;
}) {
	return (
		<div
			className={cn(
				"sticky top-0 z-10 flex items-center gap-1.5 px-2 py-1",
				// subtle frosted backdrop so labels stay readable while scrolling
				"bg-popover/95",
				starred
					? "text-[11px] font-semibold tracking-wide text-amber-400/90"
					: "text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/55",
			)}
		>
			{starred && (
				<Star
					className="size-3 fill-amber-400 text-amber-400"
					aria-hidden="true"
				/>
			)}
			{children}
		</div>
	);
}

function Divider() {
	return <div className="mx-1 my-0.5 h-px bg-border/50" aria-hidden="true" />;
}

type ModelRowProps = {
	option: AgentModelOption;
	/** Potentially trimmed display label (provider prefix stripped within its section). */
	displayLabel: string;
	isSelected: boolean;
	isFavourited: boolean;
	flatIndex: number;
	focusIndex: number;
	onSelect: (modelId: string) => void;
	onToggleFavourite: (modelId: string) => void;
};

function ModelRow({
	option,
	displayLabel,
	isSelected,
	isFavourited,
	flatIndex,
	focusIndex,
	onSelect,
	onToggleFavourite,
}: ModelRowProps) {
	const isKeyFocused = focusIndex === flatIndex;

	const handleSelectClick = useCallback(() => {
		onSelect(option.id);
	}, [onSelect, option.id]);

	const handleStarClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onToggleFavourite(option.id);
		},
		[onToggleFavourite, option.id],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onSelect(option.id);
			}
		},
		[onSelect, option.id],
	);

	return (
		<div
			role="option"
			aria-selected={isSelected}
			className="group relative flex w-full items-center"
		>
			{/* Model select button */}
			<button
				type="button"
				data-model-row
				data-model-id={option.id}
				tabIndex={-1}
				onClick={handleSelectClick}
				onKeyDown={handleKeyDown}
				className={cn(
					"flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-[5px] text-left",
					"text-[13px] text-foreground/80 transition-colors duration-100",
					"hover:bg-accent/60 hover:text-foreground",
					"focus-visible:bg-accent/60 focus-visible:text-foreground focus-visible:outline-none",
					isKeyFocused && "bg-accent/50 text-foreground",
					isSelected && "text-foreground",
					// extra right padding reserves space for the star button
					"pr-7",
				)}
				aria-label={option.label}
			>
				<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
					<ModelIcon model={option} className="size-4" />
				</span>
				<span className="min-w-0 flex-1 truncate text-[12.5px]">
					{displayLabel}
				</span>
				{isSelected && (
					<Check
						className="size-3 shrink-0 text-foreground/50"
						strokeWidth={2.5}
						aria-hidden="true"
					/>
				)}
			</button>

			{/* Star — absolutely positioned over the right edge of the row so its
			    click never bubbles to the model-select button. */}
			<button
				type="button"
				aria-label={
					isFavourited ? "Remove from favourites" : "Add to favourites"
				}
				tabIndex={-1}
				onClick={handleStarClick}
				className={cn(
					"absolute right-1 flex size-5 cursor-pointer items-center justify-center rounded",
					"transition-all duration-150",
					isFavourited
						? "text-amber-400 opacity-100 hover:text-amber-500"
						: "text-muted-foreground/40 opacity-0 hover:text-muted-foreground group-hover:opacity-100",
				)}
			>
				<Star
					className={cn("size-3", isFavourited && "fill-current")}
					aria-hidden="true"
				/>
			</button>
		</div>
	);
}

function AddCustomModelRow({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-[5px] text-left",
				"text-[12.5px] text-muted-foreground transition-colors duration-100",
				"hover:bg-accent/60 hover:text-foreground",
				"focus-visible:bg-accent/60 focus-visible:outline-none",
			)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				<Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
			</span>
			<span>Add custom model...</span>
		</button>
	);
}
