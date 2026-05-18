import { Database, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { type LibsqlExperimentResult, runLibsqlExperiment } from "@/lib/api";
import {
	SettingsGroup,
	SettingsNotice,
	SettingsRow,
} from "../components/settings-row";

export function LibsqlExperimentPanel() {
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<LibsqlExperimentResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleRun = useCallback(async () => {
		setRunning(true);
		setError(null);
		setResult(null);
		try {
			const next = await runLibsqlExperiment();
			setResult(next);
		} catch (caught) {
			const message =
				caught instanceof Error
					? caught.message
					: String(caught ?? "Unknown error");
			setError(message);
		} finally {
			setRunning(false);
		}
	}, []);

	return (
		<SettingsGroup>
			<SettingsRow
				align="start"
				title={
					<span className="flex items-center gap-1.5">
						<Database className="size-3.5 text-muted-foreground" />
						<span>libSQL local database check</span>
					</span>
				}
				description={
					<>
						Exercise the local libSQL startup path and schema visibility against
						the active Helmor data directory.
						{result ? (
							<SettingsNotice tone="ok">
								{result.tableCount} tables, journal mode{" "}
								<code className="rounded bg-muted px-1 py-0.5">
									{result.journalMode}
								</code>
								, {result.settingsCount} settings, {result.elapsedMs}ms.
							</SettingsNotice>
						) : null}
						{error ? (
							<SettingsNotice tone="error">{error}</SettingsNotice>
						) : null}
					</>
				}
			>
				<Button
					variant="outline"
					size="sm"
					onClick={handleRun}
					disabled={running}
				>
					{running ? (
						<>
							<Loader2 className="mr-1.5 size-3.5 animate-spin" />
							Running
						</>
					) : (
						"Run Check"
					)}
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
