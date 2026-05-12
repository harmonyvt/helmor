import { Download, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { runHelmorAppInstall } from "@/lib/api";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

export function LocalAppUpdatePanel() {
	const [installingApp, setInstallingApp] = useState(false);
	const [appInstallError, setAppInstallError] = useState<string | null>(null);

	const handleInstallApp = useCallback(async () => {
		setInstallingApp(true);
		setAppInstallError(null);
		try {
			await runHelmorAppInstall();
		} catch (e) {
			setAppInstallError(e instanceof Error ? e.message : String(e));
			setInstallingApp(false);
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
					<span>App Updates</span>
				</span>
			}
			description={
				<>
					Pull the latest changes into
					<code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
						~/helmor
					</code>
					then build the production macOS app and install it to
					<code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
						/Applications/Helmor.app
					</code>
					, then restart Helmor.
					{appInstallError ? (
						<SettingsNotice tone="error">{appInstallError}</SettingsNotice>
					) : null}
				</>
			}
		>
			<Button
				variant="outline"
				size="sm"
				onClick={handleInstallApp}
				disabled={installingApp}
			>
				{installingApp ? (
					<>
						<Loader2 className="mr-1.5 size-3.5 animate-spin" />
						Installing...
					</>
				) : (
					"Install & Restart"
				)}
			</Button>
		</SettingsRow>
	);
}
