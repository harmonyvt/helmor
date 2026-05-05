import { Copy, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	type RemoteWorkspaceProfileSetting,
	useSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow } from "../components/settings-row";

type RemoteBackend = RemoteWorkspaceProfileSetting["backend"];

type ProfileDraft = {
	name: string;
	backend: RemoteBackend;
	target: string;
	remoteRoot: string;
	bootstrapCommand: string;
};

const DEFAULT_DOCKER_IMAGE = "node:22-bookworm";
const DEFAULT_SSH_HOST = "user@host";
const DEFAULT_REMOTE_ROOT = "~/helmor-workspaces";

function profileTarget(profile: RemoteWorkspaceProfileSetting): string {
	return profile.backend === "docker"
		? profile.dockerImage || DEFAULT_DOCKER_IMAGE
		: profile.sshHost || DEFAULT_SSH_HOST;
}

function profileToDraft(profile?: RemoteWorkspaceProfileSetting): ProfileDraft {
	return {
		name: profile?.name || "Docker default",
		backend: profile?.backend || "docker",
		target: profile ? profileTarget(profile) : DEFAULT_DOCKER_IMAGE,
		remoteRoot: profile?.remoteRoot || DEFAULT_REMOTE_ROOT,
		bootstrapCommand: profile?.bootstrapCommand || "",
	};
}

function draftToProfile(
	id: string,
	draft: ProfileDraft,
): RemoteWorkspaceProfileSetting {
	const trimmedTarget = draft.target.trim();
	return {
		id,
		name: draft.name.trim() || `${draft.backend} profile`,
		backend: draft.backend,
		remoteRoot: draft.remoteRoot.trim() || DEFAULT_REMOTE_ROOT,
		bootstrapCommand: draft.bootstrapCommand.trim() || null,
		...(draft.backend === "docker"
			? { dockerImage: trimmedTarget || DEFAULT_DOCKER_IMAGE, sshHost: null }
			: { sshHost: trimmedTarget || DEFAULT_SSH_HOST, dockerImage: null }),
	};
}

function createProfileId(backend: RemoteBackend): string {
	return `${backend}-${Date.now().toString(36)}`;
}

export function RemoteWorkspacesPanel() {
	const { settings, updateSettings } = useSettings();
	const [selectedProfileId, setSelectedProfileId] = useState(
		settings.defaultRemoteWorkspaceProfileId ||
			settings.remoteWorkspaceProfiles[0]?.id ||
			"",
	);
	const selectedProfile = useMemo(
		() =>
			settings.remoteWorkspaceProfiles.find(
				(profile) => profile.id === selectedProfileId,
			) ?? settings.remoteWorkspaceProfiles[0],
		[settings.remoteWorkspaceProfiles, selectedProfileId],
	);
	const [draft, setDraft] = useState(() => profileToDraft(selectedProfile));

	const updateProfiles = async (
		profiles: RemoteWorkspaceProfileSetting[],
		defaultProfileId = settings.defaultRemoteWorkspaceProfileId,
	) => {
		await updateSettings({
			remoteWorkspaceProfiles: profiles,
			defaultRemoteWorkspaceProfileId:
				defaultProfileId &&
				profiles.some((profile) => profile.id === defaultProfileId)
					? defaultProfileId
					: profiles[0]?.id || null,
		});
	};

	const handleSelectProfile = (profile: RemoteWorkspaceProfileSetting) => {
		setSelectedProfileId(profile.id);
		setDraft(profileToDraft(profile));
	};

	const handleAddProfile = async () => {
		const id = createProfileId(draft.backend);
		const profile = draftToProfile(id, draft);
		const nextProfiles = [...settings.remoteWorkspaceProfiles, profile];
		setSelectedProfileId(id);
		setDraft(profileToDraft(profile));
		await updateProfiles(nextProfiles, id);
	};

	const handleSaveProfile = async () => {
		if (!selectedProfile) {
			await handleAddProfile();
			return;
		}
		const nextProfile = draftToProfile(selectedProfile.id, draft);
		await updateProfiles(
			settings.remoteWorkspaceProfiles.map((profile) =>
				profile.id === selectedProfile.id ? nextProfile : profile,
			),
			settings.defaultRemoteWorkspaceProfileId,
		);
	};

	const handleDuplicateProfile = async () => {
		const id = createProfileId(draft.backend);
		const profile = {
			...draftToProfile(id, draft),
			name: `${draft.name.trim() || "Remote profile"} copy`,
		};
		setSelectedProfileId(id);
		setDraft(profileToDraft(profile));
		await updateProfiles([...settings.remoteWorkspaceProfiles, profile], id);
	};

	const handleRemoveProfile = async (profileId: string) => {
		const nextProfiles = settings.remoteWorkspaceProfiles.filter(
			(profile) => profile.id !== profileId,
		);
		const nextSelected = nextProfiles[0]?.id || "";
		setSelectedProfileId(nextSelected);
		setDraft(profileToDraft(nextProfiles[0]));
		await updateProfiles(
			nextProfiles,
			settings.defaultRemoteWorkspaceProfileId,
		);
	};

	return (
		<div className="flex flex-col gap-5 py-5">
			<div>
				<div className="text-[13px] font-medium leading-snug text-foreground">
					Remote Workspaces
				</div>
				<div className="mt-1 text-[12px] leading-snug text-muted-foreground">
					Remote workspaces run over Docker or SSH, delegate only to Pi, and can
					optionally copy your local Pi auth config when the workspace is
					created.
				</div>
			</div>

			<SettingsGroup>
				<SettingsRow
					title="Enable remote workspaces"
					description="Show the Local / Remote choice when creating workspaces. Remote creation stays Pi-only."
				>
					<Switch
						checked={settings.remoteWorkspacesEnabled}
						onCheckedChange={(checked) =>
							updateSettings({ remoteWorkspacesEnabled: checked })
						}
					/>
				</SettingsRow>
				<SettingsRow
					title="Default location"
					description="Choose which option is selected when the workspace dialog opens."
				>
					<div className="flex rounded-lg border border-border/60 bg-muted/30 p-1">
						{(["local", "remote"] as const).map((location) => (
							<button
								key={location}
								type="button"
								disabled={
									location === "remote" && !settings.remoteWorkspacesEnabled
								}
								onClick={() =>
									updateSettings({ defaultWorkspaceLocation: location })
								}
								className={cn(
									"h-7 cursor-pointer rounded-md px-3 text-[12px] capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									settings.defaultWorkspaceLocation === location
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{location}
							</button>
						))}
					</div>
				</SettingsRow>
				<SettingsRow
					title="Copy Pi config by default"
					description="When enabled, new remote workspaces default to copying ~/.pi/agent/auth.json into the remote target."
				>
					<Switch
						checked={settings.defaultRemoteWorkspaceCopyPiConfig}
						onCheckedChange={(checked) =>
							updateSettings({ defaultRemoteWorkspaceCopyPiConfig: checked })
						}
					/>
				</SettingsRow>
				<SettingsRow
					title="Default profile"
					description="Used automatically when Remote is selected in the create workspace dialog."
				>
					<select
						value={settings.defaultRemoteWorkspaceProfileId || ""}
						onChange={(event) =>
							updateSettings({
								defaultRemoteWorkspaceProfileId: event.target.value || null,
							})
						}
						className="h-8 min-w-[180px] cursor-pointer rounded-md border border-input bg-background px-2 text-[13px] outline-none"
					>
						<option value="">First available profile</option>
						{settings.remoteWorkspaceProfiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.name}
							</option>
						))}
					</select>
				</SettingsRow>
			</SettingsGroup>

			<div className="grid min-h-[300px] grid-cols-[220px_1fr] overflow-hidden rounded-xl border border-border/60">
				<div className="flex min-h-0 flex-col border-r border-border/60 bg-muted/20">
					<div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
						<div className="text-[12px] font-medium text-muted-foreground">
							Profiles
						</div>
						<Button size="icon-xs" variant="ghost" onClick={handleAddProfile}>
							<Plus className="size-3" />
						</Button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto p-2">
						{settings.remoteWorkspaceProfiles.length === 0 ? (
							<div className="rounded-lg border border-dashed border-border/70 p-3 text-[12px] leading-snug text-muted-foreground">
								No profiles yet. Fill out the editor and click Add.
							</div>
						) : (
							settings.remoteWorkspaceProfiles.map((profile) => (
								<button
									key={profile.id}
									type="button"
									onClick={() => handleSelectProfile(profile)}
									className={cn(
										"mb-1 flex w-full cursor-pointer flex-col items-start rounded-lg px-2 py-2 text-left transition-colors",
										selectedProfile?.id === profile.id
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
									)}
								>
									<span className="max-w-full truncate text-[13px] font-medium">
										{profile.name}
									</span>
									<span className="max-w-full truncate text-[11px] uppercase tracking-wide">
										{profile.backend}
									</span>
								</button>
							))
						)}
					</div>
				</div>

				<div className="flex min-w-0 flex-col gap-3 p-4">
					<div className="grid grid-cols-[1fr_132px] gap-2">
						<div className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
							Profile name
							<Input
								value={draft.name}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										name: event.target.value,
									}))
								}
							/>
						</div>
						<label className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
							Backend
							<select
								value={draft.backend}
								onChange={(event) => {
									const backend = event.target.value as RemoteBackend;
									setDraft((current) => ({
										...current,
										backend,
										target:
											backend === "docker"
												? DEFAULT_DOCKER_IMAGE
												: DEFAULT_SSH_HOST,
									}));
								}}
								className="h-9 cursor-pointer rounded-md border border-input bg-background px-2 text-[13px]"
							>
								<option value="docker">Docker</option>
								<option value="ssh">SSH</option>
							</select>
						</label>
					</div>
					<div className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
						{draft.backend === "docker" ? "Docker image" : "SSH host"}
						<Input
							value={draft.target}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									target: event.target.value,
								}))
							}
							placeholder={
								draft.backend === "docker"
									? DEFAULT_DOCKER_IMAGE
									: DEFAULT_SSH_HOST
							}
						/>
					</div>
					<div className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
						Remote root
						<Input
							value={draft.remoteRoot}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									remoteRoot: event.target.value,
								}))
							}
							placeholder={DEFAULT_REMOTE_ROOT}
						/>
					</div>
					<div className="flex flex-col gap-1 text-[12px] font-medium text-muted-foreground">
						Bootstrap command
						<Input
							value={draft.bootstrapCommand}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									bootstrapCommand: event.target.value,
								}))
							}
							placeholder="Optional shell command before clone"
						/>
					</div>
					<div className="rounded-lg bg-muted/35 p-3 text-[12px] leading-snug text-muted-foreground">
						Docker profiles create or reuse one long-running container per repo.
						SSH profiles require passwordless access and remote git plus
						node+npx or bunx.
					</div>
					<div className="mt-auto flex justify-end gap-2">
						{selectedProfile ? (
							<Button
								type="button"
								variant="ghost"
								onClick={() => handleRemoveProfile(selectedProfile.id)}
							>
								<Trash2 className="size-3.5" />
								Remove
							</Button>
						) : null}
						<Button
							type="button"
							variant="secondary"
							onClick={handleDuplicateProfile}
						>
							<Copy className="size-3.5" />
							Duplicate
						</Button>
						<Button
							type="button"
							onClick={selectedProfile ? handleSaveProfile : handleAddProfile}
						>
							{selectedProfile ? "Save profile" : "Add profile"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
