import { Download, Loader2, PackageCheck, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type CliStatus,
	getCliStatus,
	getHelmorSkillsStatus,
	type HelmorSkillsStatus,
	installCli,
	installHelmorSkills,
} from "@/lib/api";
import {
	SettingsGroup,
	SettingsNotice,
	SettingsRow,
} from "../components/settings-row";

export function CliInstallPanel() {
	const [status, setStatus] = useState<CliStatus | null>(null);
	const [skillsStatus, setSkillsStatus] = useState<HelmorSkillsStatus | null>(
		null,
	);
	const [installing, setInstalling] = useState(false);
	const [installingSkills, setInstallingSkills] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [skillsError, setSkillsError] = useState<string | null>(null);
	const commandName =
		status?.buildMode === "development" ? "helmor-dev" : "helmor";
	const buildLabel = status?.buildMode === "development" ? "Debug" : "Release";
	const isManaged = status?.installState === "managed";
	const isStale = status?.installState === "stale";
	const buttonLabel =
		isManaged || isStale ? "Reinstall" : "Install to /usr/local/bin";

	useEffect(() => {
		void getCliStatus().then(setStatus).catch(setError);
		void getHelmorSkillsStatus().then(setSkillsStatus).catch(setSkillsError);
	}, []);

	const handleInstall = useCallback(async () => {
		setInstalling(true);
		setError(null);
		try {
			const result = await installCli();
			setStatus(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setInstalling(false);
		}
	}, []);

	const handleInstallSkills = useCallback(async () => {
		setInstallingSkills(true);
		setSkillsError(null);
		try {
			const result = await installHelmorSkills();
			setSkillsStatus(result);
		} catch (e) {
			setSkillsError(e instanceof Error ? e.message : String(e));
		} finally {
			setInstallingSkills(false);
		}
	}, []);

	return (
		<SettingsGroup>
			<SettingsRow
				align="start"
				title={
					<span className="flex items-center gap-1.5">
						<Terminal
							className="size-3.5 text-muted-foreground"
							strokeWidth={1.8}
						/>
						<span>Command Line Tool</span>
					</span>
				}
				description={
					<>
						Install the{" "}
						<code className="rounded bg-muted px-1 py-0.5 text-[11px]">
							{commandName}
						</code>{" "}
						command as a symlink to this app&apos;s bundled CLI so terminal
						usage tracks desktop updates automatically. {buildLabel} build.
						{isManaged ? (
							<SettingsNotice tone="ok">
								Installed at{" "}
								<code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
									{status?.installPath}
								</code>
							</SettingsNotice>
						) : null}
						{isStale ? (
							<SettingsNotice tone="warn">
								Existing CLI at{" "}
								<code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
									{status?.installPath}
								</code>{" "}
								is not managed by this app. Reinstall to point it at the bundled
								CLI.
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
					onClick={handleInstall}
					disabled={installing}
				>
					{installing ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Download className="size-3.5" strokeWidth={1.8} />
					)}
					{buttonLabel}
				</Button>
			</SettingsRow>
			<SettingsRow
				align="start"
				title={
					<span className="flex items-center gap-1.5">
						<PackageCheck
							className="size-3.5 text-muted-foreground"
							strokeWidth={1.8}
						/>
						<span>Agent Skills</span>
					</span>
				}
				description={
					<>
						Install bundled Helmor skills into Codex, Claude, and generic agent
						skill directories.
						{skillsStatus ? (
							<SettingsNotice tone={skillsStatus.installed ? "ok" : "warn"}>
								Codex {skillsStatus.codex ? "installed" : "missing"} | Claude{" "}
								{skillsStatus.claude ? "installed" : "missing"} | Agents{" "}
								{skillsStatus.agents ? "installed" : "missing"}
							</SettingsNotice>
						) : null}
						{skillsError ? (
							<SettingsNotice tone="error">{skillsError}</SettingsNotice>
						) : null}
					</>
				}
			>
				<Button
					variant="outline"
					size="sm"
					onClick={handleInstallSkills}
					disabled={installingSkills}
				>
					{installingSkills ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Download className="size-3.5" strokeWidth={1.8} />
					)}
					Reinstall skills
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
