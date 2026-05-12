import { Download, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { restartApp, runHelmorAppInstall } from "@/lib/api";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

export function LocalAppUpdatePanel() {
	const [installingApp, setInstallingApp] = useState(false);
	const [appInstallError, setAppInstallError] = useState<string | null>(null);
	const pushToast = useWorkspaceToast();

	const handleInstallApp = useCallback(async () => {
		setInstallingApp(true);
		setAppInstallError(null);
		try {
			const result = await runHelmorAppInstall();
			setInstallingApp(false);
			if (result.restartRequired) {
				pushToast(
					"The new app has been installed. Restart Helmor to start using it.",
					"Restart required",
					"default",
					{
						persistent: true,
						action: {
							label: "Restart now",
							onClick: () => {
								void restartApp(true).catch((error) => {
									pushToast(
										error instanceof Error ? error.message : String(error),
										"Unable to restart Helmor",
										"destructive",
									);
								});
							},
						},
					},
				);
			}
		} catch (e) {
			setAppInstallError(e instanceof Error ? e.message : String(e));
			setInstallingApp(false);
		}
	}, [pushToast]);

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
					. Helmor will ask you to restart when installation finishes.
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
					"Install Update"
				)}
			</Button>
		</SettingsRow>
	);
}
