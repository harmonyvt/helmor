import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	Box,
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	RefreshCw,
	Trash2,
} from "lucide-react";
import type { SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import {
	DeepSeekIcon,
	KimiIcon,
	MinimaxIcon,
	QwenIcon,
	XiaomiMiMoIcon,
	ZhipuIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { replacePiModels } from "@/lib/agent-models";
import {
	type AgentModelSection,
	checkPiModels,
	type PiModelCheckResponse,
	type PiModelProviderSummary,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import type { ClaudeCustomProviderSettings } from "@/lib/settings";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { SettingsRow } from "../components/settings-row";
import {
	BUILTIN_CLAUDE_PROVIDERS,
	type BuiltinClaudeProviderKey,
	findBuiltinClaudeProvider,
} from "./builtin-claude-providers";

type ProviderKind = BuiltinClaudeProviderKey | "custom";

type Draft = {
	baseUrl: string;
	apiKey: string;
	models: string;
};

type PiCheckState =
	| { status: "idle" }
	| { status: "success"; result: PiModelCheckResponse }
	| { status: "empty"; result: PiModelCheckResponse }
	| { status: "error"; message: string };

export function PiModelsCheckPanel() {
	const queryClient = useQueryClient();
	const [state, setState] = useState<PiCheckState>({ status: "idle" });
	const [checking, setChecking] = useState(false);

	async function handleCheck() {
		setChecking(true);
		try {
			const result = await checkPiModels();
			if (result.status === "error") {
				setState({
					status: "error",
					message: result.error ?? "Unable to check Pi models.",
				});
				return;
			}

			if (result.models.length > 0) {
				queryClient.setQueryData<AgentModelSection[]>(
					helmorQueryKeys.agentModelSections,
					(current) => replacePiModels(current, result.models),
				);
				setState({ status: "success", result });
			} else {
				setState({ status: "empty", result });
			}
		} catch (error) {
			setState({
				status: "error",
				message:
					error instanceof Error ? error.message : "Unable to check Pi models.",
			});
		} finally {
			setChecking(false);
		}
	}

	return (
		<SettingsRow
			title="Pi models"
			description="Check Pi for configured providers and available models. Successful checks update the Pi models in the default model menu."
			align="start"
			className="gap-8"
		>
			<div className="flex w-[360px] flex-col gap-3">
				<div className="flex items-center justify-between gap-3">
					<PiCheckSummary state={state} />
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void handleCheck()}
						disabled={checking}
						className="shrink-0 gap-1.5"
					>
						<RefreshCw
							className={cn("size-3.5", checking ? "animate-spin" : null)}
						/>
						{checking ? "Checking…" : "Check Pi"}
					</Button>
				</div>
				{state.status === "success" ? (
					<PiCheckDetails result={state.result} />
				) : null}
			</div>
		</SettingsRow>
	);
}

function PiCheckSummary({ state }: { state: PiCheckState }) {
	if (state.status === "idle") {
		return (
			<div className="min-w-0 text-[12px] text-muted-foreground">
				Not checked yet.
			</div>
		);
	}
	if (state.status === "error") {
		return (
			<div className="min-w-0 text-[12px] text-destructive">
				{state.message}
			</div>
		);
	}
	if (state.status === "empty") {
		return (
			<div className="min-w-0 text-[12px] text-muted-foreground">
				No Pi models are currently available. Static fallback models remain in
				the menu.
			</div>
		);
	}

	return (
		<div className="min-w-0 text-[12px] text-muted-foreground">
			<span className="font-medium text-foreground">
				{state.result.models.length} Pi models
			</span>{" "}
			available from {formatProviderCount(state.result.providers)}.
		</div>
	);
}

function PiCheckDetails({ result }: { result: PiModelCheckResponse }) {
	return (
		<div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
			<div className="flex flex-wrap gap-1.5">
				{result.providers.map((provider) => (
					<span
						key={provider.key}
						className="rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground"
					>
						{provider.label} · {provider.modelCount}
					</span>
				))}
			</div>
			<div className="mt-2 max-h-28 overflow-y-auto pr-1">
				{result.models.map((model) => (
					<div
						key={model.id}
						className="flex min-h-6 items-center gap-2 text-[12px]"
					>
						<span className="min-w-0 flex-1 truncate text-foreground">
							{model.label}
						</span>
						<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
							{model.cliModel}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function formatProviderCount(providers: PiModelProviderSummary[]): string {
	if (providers.length === 1) return providers[0]?.label ?? "1 provider";
	return `${providers.length} providers`;
}

export function ClaudeCustomProvidersPanel() {
	const queryClient = useQueryClient();
	const { settings, updateSettings } = useSettings();
	const value = settings.claudeCustomProviders;
	const builtinProviderApiKeys = value.builtinProviderApiKeys ?? {};
	const configuredItems = useMemo(() => getConfiguredItems(value), [value]);
	const initialKind = configuredItems[0]?.kind ?? "minimax";
	const [kind, setKind] = useState<ProviderKind>(initialKind);
	const [draft, setDraft] = useState<Draft>(() =>
		draftFromSettings(value, initialKind),
	);

	useEffect(() => {
		setDraft(draftFromSettings(value, kind));
	}, [kind, value]);

	function updateProvider(patch: Partial<ClaudeCustomProviderSettings>) {
		void Promise.resolve(
			updateSettings({
				claudeCustomProviders: {
					...value,
					...patch,
				},
			}),
		).then(() =>
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.agentModelSections,
			}),
		);
	}

	function saveDraftIfComplete() {
		if (!canSave(kind, draft)) return;
		const apiKey = draft.apiKey.trim();
		if (kind === "custom") {
			updateProvider({
				customBaseUrl: draft.baseUrl.trim(),
				customApiKey: apiKey,
				customModels: draft.models.trim(),
			});
			return;
		}

		const nextKeys = { ...builtinProviderApiKeys };
		if (apiKey) {
			nextKeys[kind] = apiKey;
		} else {
			delete nextKeys[kind];
		}
		updateProvider({
			builtinProviderApiKeys: nextKeys,
		});
	}

	function removeProvider(itemKind: ProviderKind) {
		if (itemKind === "custom") {
			updateProvider({
				customBaseUrl: "",
				customApiKey: "",
				customModels: "",
			});
			if (kind === "custom") setKind("minimax");
			return;
		}

		const nextKeys = { ...builtinProviderApiKeys };
		delete nextKeys[itemKind];
		updateProvider({
			builtinProviderApiKeys: nextKeys,
		});
	}

	const builtinProvider =
		kind === "custom" ? null : findBuiltinClaudeProvider(kind);

	return (
		<SettingsRow
			title="Claude Code custom providers"
			description="Enter API keys here to use third-party models. They can be used alongside Claude Code's official models."
			align="start"
			className="gap-8"
		>
			<div className="flex w-[360px] flex-col gap-3">
				<div className="grid gap-2">
					<ProviderPicker
						kind={kind}
						configuredKinds={new Set(configuredItems.map((item) => item.kind))}
						onChange={setKind}
					/>

					{builtinProvider ? (
						<div className="flex items-center gap-2">
							<Input
								type="password"
								value={draft.apiKey}
								onBlur={saveDraftIfComplete}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										apiKey: event.target.value,
									}))
								}
								placeholder={`${builtinProvider.label} API key`}
								className="h-8 min-w-0 flex-1 border-border/50 bg-muted/20 text-[13px]"
							/>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label={`Get ${builtinProvider.label} API key`}
											onClick={() => void openUrl(builtinProvider.apiKeyUrl)}
										>
											<ExternalLink className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Get API key</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					) : (
						<div className="grid gap-2">
							<Input
								value={draft.baseUrl}
								onBlur={saveDraftIfComplete}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										baseUrl: event.target.value,
									}))
								}
								placeholder="Base URL"
								className="h-8 border-border/50 bg-muted/20 text-[13px]"
							/>
							<Input
								type="password"
								value={draft.apiKey}
								onBlur={saveDraftIfComplete}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										apiKey: event.target.value,
									}))
								}
								placeholder="API key"
								className="h-8 border-border/50 bg-muted/20 text-[13px]"
							/>
							<Textarea
								value={draft.models}
								onBlur={saveDraftIfComplete}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										models: event.target.value,
									}))
								}
								placeholder={`model-a
model-b
model-c`}
								className="h-20 resize-none overflow-y-auto border-border/50 bg-muted/20 text-[13px]"
							/>
						</div>
					)}
				</div>

				<ConfiguredProvidersList
					items={configuredItems}
					onRemove={removeProvider}
				/>
			</div>
		</SettingsRow>
	);
}
function ProviderPicker({
	kind,
	configuredKinds,
	onChange,
}: {
	kind: ProviderKind;
	configuredKinds: Set<ProviderKind>;
	onChange: (kind: ProviderKind) => void;
}) {
	const builtinProvider =
		kind === "custom" ? null : findBuiltinClaudeProvider(kind);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={cn(
					"flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 text-[13px] text-foreground hover:bg-muted/50",
				)}
			>
				<span className="flex min-w-0 items-center gap-2">
					{builtinProvider ? (
						<BuiltinProviderIcon
							icon={builtinProvider.icon}
							className="size-4"
						/>
					) : (
						<Box className="size-4 text-muted-foreground" />
					)}
					<span className="truncate">{builtinProvider?.label ?? "Custom"}</span>
				</span>
				<ChevronDown className="size-3 shrink-0 opacity-40" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-[360px]">
				{BUILTIN_CLAUDE_PROVIDERS.map((provider) => (
					<DropdownMenuItem
						key={provider.key}
						onClick={() => onChange(provider.key)}
						className="flex items-center justify-between gap-3"
					>
						<span className="flex items-center gap-2">
							<BuiltinProviderIcon icon={provider.icon} className="size-4" />
							{provider.label}
						</span>
						{configuredKinds.has(provider.key) ? (
							<CheckCircle2 className="size-3.5 text-emerald-500" />
						) : null}
					</DropdownMenuItem>
				))}
				<DropdownMenuItem
					onClick={() => onChange("custom")}
					className="flex items-center justify-between gap-3"
				>
					<span className="flex items-center gap-2">
						<Box className="size-4 text-muted-foreground" />
						Custom
					</span>
					{configuredKinds.has("custom") ? (
						<CheckCircle2 className="size-3.5 text-emerald-500" />
					) : null}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ConfiguredProvidersList({
	items,
	onRemove,
}: {
	items: ConfiguredItem[];
	onRemove: (kind: ProviderKind) => void;
}) {
	if (items.length === 0) {
		return (
			<div className="pt-1 text-[12px] text-muted-foreground">
				No third-party providers configured.
			</div>
		);
	}

	return (
		<div className="px-3 pt-1">
			{items.map((item, index) => (
				<div
					key={item.kind}
					className={cn(
						"flex min-h-8 items-center gap-2 py-1.5",
						index > 0 ? "border-t border-border/30" : null,
					)}
				>
					<div className="flex size-4 shrink-0 items-center justify-center">
						<ProviderIcon item={item} className="size-4" />
					</div>
					<div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
						{item.label}
					</div>
					<div className="w-[88px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
						{item.keyPreview}
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={`Remove ${item.label}`}
						onClick={() => onRemove(item.kind)}
						className="text-muted-foreground hover:text-destructive"
					>
						<Trash2 className="size-3.5" strokeWidth={1.8} />
					</Button>
				</div>
			))}
		</div>
	);
}

type ConfiguredItem = {
	kind: ProviderKind;
	label: string;
	icon?: "minimax" | "moonshot" | "deepseek" | "zhipu" | "qwen" | "xiaomi";
	keyPreview: string;
};

function getConfiguredItems(
	value: ClaudeCustomProviderSettings,
): ConfiguredItem[] {
	const items: ConfiguredItem[] = [];
	const keys = value.builtinProviderApiKeys ?? {};
	for (const provider of BUILTIN_CLAUDE_PROVIDERS) {
		const apiKey = keys[provider.key]?.trim();
		if (!apiKey) continue;
		items.push({
			kind: provider.key,
			label: provider.label,
			icon: provider.icon,
			keyPreview: maskSecret(apiKey),
		});
	}
	if (isCustomConfigured(value)) {
		items.push({
			kind: "custom",
			label: "Custom",
			keyPreview: maskSecret(value.customApiKey),
		});
	}
	return items;
}

function draftFromSettings(
	value: ClaudeCustomProviderSettings,
	kind: ProviderKind,
): Draft {
	if (kind === "custom") {
		return {
			baseUrl: value.customBaseUrl,
			apiKey: value.customApiKey,
			models: value.customModels,
		};
	}
	return {
		baseUrl: "",
		apiKey: value.builtinProviderApiKeys?.[kind] ?? "",
		models: "",
	};
}

function canSave(kind: ProviderKind, draft: Draft): boolean {
	if (kind === "custom") {
		return Boolean(
			draft.baseUrl.trim() &&
				draft.apiKey.trim() &&
				parseModelList(draft.models).length > 0,
		);
	}
	return Boolean(draft.apiKey.trim());
}

function isCustomConfigured(value: ClaudeCustomProviderSettings): boolean {
	return Boolean(
		value.customBaseUrl.trim() &&
			value.customApiKey.trim() &&
			parseModelList(value.customModels).length > 0,
	);
}

function parseModelList(raw: string): string[] {
	return raw
		.split("\n")
		.map((item) => item.trim())
		.filter(Boolean);
}

function maskSecret(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length <= 8) return "••••";
	return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function ProviderIcon({
	item,
	className,
}: {
	item: ConfiguredItem;
	className?: string;
}) {
	if (item.icon)
		return <BuiltinProviderIcon icon={item.icon} className={className} />;
	return <Box className={cn("text-muted-foreground", className)} />;
}

function BuiltinProviderIcon({
	icon,
	className,
}: {
	icon: "minimax" | "moonshot" | "deepseek" | "zhipu" | "qwen" | "xiaomi";
	className?: string;
}) {
	const props: SVGProps<SVGSVGElement> = { className };
	switch (icon) {
		case "moonshot":
			return <KimiIcon {...props} />;
		case "deepseek":
			return <DeepSeekIcon {...props} />;
		case "zhipu":
			return <ZhipuIcon {...props} />;
		case "qwen":
			return <QwenIcon {...props} />;
		case "xiaomi":
			return <XiaomiMiMoIcon {...props} />;
		default:
			return <MinimaxIcon {...props} />;
	}
}
