import { Database, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	type DataDirPreference,
	type DataInfo,
	loadDataInfo,
	restartApp,
	setDataDirPreference,
} from "@/lib/api";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

const PREFERENCES = [
	{ value: "automatic", label: "Automatic" },
	{ value: "production", label: "Production" },
	{ value: "development", label: "Development" },
] as const satisfies ReadonlyArray<{
	value: DataDirPreference;
	label: string;
}>;

export function DataSourceSettingsRow() {
	const [info, setInfo] = useState<DataInfo | null>(null);
	const [saving, setSaving] = useState(false);
	const [restarting, setRestarting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		const next = await loadDataInfo();
		if (next) setInfo(next);
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const restartRequired = useMemo(() => {
		if (!info || info.dataDirLockedByEnv) return false;
		return (
			targetMode(info.dataDirPreference, info.defaultDataMode) !== info.dataMode
		);
	}, [info]);

	const handlePreferenceChange = useCallback(
		async (value: string) => {
			if (!isDataDirPreference(value) || value === info?.dataDirPreference) {
				return;
			}
			setSaving(true);
			setError(null);
			try {
				await setDataDirPreference(value);
				await reload();
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setSaving(false);
			}
		},
		[info?.dataDirPreference, reload],
	);

	const handleRestart = useCallback(async () => {
		setRestarting(true);
		setError(null);
		try {
			await restartApp(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setRestarting(false);
		}
	}, []);

	return (
		<SettingsRow
			align="start"
			title={
				<span className="flex items-center gap-1.5">
					<Database
						className="size-3.5 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<span>Data Source</span>
				</span>
			}
			description={
				<>
					Choose which Helmor database this app uses on startup.
					{info ? (
						<SettingsNotice tone={restartRequired ? "warn" : "info"}>
							Active: {modeLabel(info.dataMode)} data at{" "}
							<code className="rounded bg-muted px-1 py-0.5">
								{info.dataDir}
							</code>
						</SettingsNotice>
					) : null}
					{info?.dataDirLockedByEnv ? (
						<SettingsNotice tone="warn">
							HELMOR_DATA_DIR is set, so the startup preference is ignored.
						</SettingsNotice>
					) : null}
					{restartRequired ? (
						<SettingsNotice tone="warn">
							Restart Helmor to switch to{" "}
							{modeLabel(
								targetMode(info!.dataDirPreference, info!.defaultDataMode),
							)}{" "}
							data.
						</SettingsNotice>
					) : null}
					{error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
				</>
			}
		>
			<div className="flex flex-wrap items-center justify-end gap-2">
				<ToggleGroup
					type="single"
					value={info?.dataDirPreference ?? "automatic"}
					onValueChange={(value) => void handlePreferenceChange(value)}
					className="gap-1 bg-muted/40"
					disabled={saving || restarting || info?.dataDirLockedByEnv}
				>
					{PREFERENCES.map(({ value, label }) => (
						<ToggleGroupItem
							key={value}
							value={value}
							aria-label={label}
							className="h-7 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
						>
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				{restartRequired ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() => void handleRestart()}
						disabled={saving || restarting}
					>
						{restarting ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<RotateCw className="size-3.5" strokeWidth={1.8} />
						)}
						Restart
					</Button>
				) : null}
			</div>
		</SettingsRow>
	);
}

function isDataDirPreference(value: string): value is DataDirPreference {
	return (
		value === "automatic" || value === "production" || value === "development"
	);
}

function targetMode(
	preference: DataDirPreference,
	defaultMode: DataInfo["defaultDataMode"],
): "production" | "development" {
	return preference === "automatic" ? defaultMode : preference;
}

function modeLabel(mode: string): string {
	switch (mode) {
		case "production":
			return "production";
		case "development":
			return "development";
		default:
			return mode;
	}
}
