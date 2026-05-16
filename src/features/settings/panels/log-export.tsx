import { openPath } from "@tauri-apps/plugin-opener";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { exportVerboseLogs } from "@/lib/api";
import { getFrontendLogs } from "@/lib/frontend-logs";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

export function LogExportPanel() {
	const [exporting, setExporting] = useState(false);
	const [exportDir, setExportDir] = useState<string | null>(null);
	const [fileCount, setFileCount] = useState(0);
	const [error, setError] = useState<string | null>(null);

	const handleExport = useCallback(async () => {
		setExporting(true);
		setError(null);
		try {
			const result = await exportVerboseLogs(getFrontendLogs());
			setExportDir(result.exportDir);
			setFileCount(result.files.length);
			await openPath(result.exportDir);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setExporting(false);
		}
	}, []);

	return (
		<SettingsRow
			align="start"
			title={
				<span className="flex items-center gap-1.5">
					<Download
						className="size-3.5 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<span>Export Logs</span>
				</span>
			}
			description={
				<>
					Export backend, sidecar, workspace, and current frontend console logs
					to a timestamped folder.
					{exportDir ? (
						<SettingsNotice tone="ok">
							Exported {fileCount} files to{" "}
							<code className="rounded bg-muted px-1 py-0.5">{exportDir}</code>
						</SettingsNotice>
					) : null}
					{error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
				</>
			}
		>
			<div className="flex items-center gap-2">
				{exportDir ? (
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Open exported logs"
						onClick={() => void openPath(exportDir)}
					>
						<FolderOpen className="size-3.5" strokeWidth={1.8} />
					</Button>
				) : null}
				<Button
					variant="outline"
					size="sm"
					onClick={() => void handleExport()}
					disabled={exporting}
				>
					{exporting ? (
						<>
							<Loader2 className="mr-1.5 size-3.5 animate-spin" />
							Exporting...
						</>
					) : (
						"Export Logs"
					)}
				</Button>
			</div>
		</SettingsRow>
	);
}
