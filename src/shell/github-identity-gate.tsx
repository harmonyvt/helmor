import { RefreshCw, Terminal } from "lucide-react";
import helmorLogoSrc from "@/assets/helmor-logo.png";
import bannerHtml from "@/assets/render-banner.html?raw";
import { GithubBrandIcon } from "@/components/brand-icon";
import { TrafficLightSpacer } from "@/components/chrome/traffic-light-spacer";
import { Button } from "@/components/ui/button";
import { TypingAnimation } from "@/components/ui/typing-animation";
import type { GithubIdentityState } from "./types";

export function GithubIdentityGate({
	identityState,
	onConnectGithub,
	onCancelGithubConnect,
}: {
	identityState: GithubIdentityState;
	onConnectGithub: () => void;
	onCancelGithubConnect: () => void;
}) {
	const message =
		identityState.status === "error"
			? identityState.message
			: identityState.status === "disconnected"
				? (identityState.cliStatus?.message ??
					"Connect GitHub CLI to continue.")
				: null;

	return (
		<main
			aria-label="GitHub identity gate"
			className="relative h-screen overflow-hidden bg-background font-sans text-foreground antialiased"
		>
			<iframe
				title="Helmor branding animation"
				srcDoc={bannerHtml}
				aria-hidden
				tabIndex={-1}
				className="pointer-events-none absolute inset-0 z-0 h-full w-full border-0 bg-transparent opacity-[0.02]"
			/>
			<div
				aria-label="GitHub identity gate drag region"
				className="absolute inset-x-0 top-0 z-20 flex h-11 items-center"
			>
				<TrafficLightSpacer side="left" width={94} />
				<div data-tauri-drag-region className="h-full flex-1" />
				<TrafficLightSpacer side="right" width={140} />
			</div>

			<div className="relative z-10 flex h-full items-center justify-center px-6">
				<div className="flex w-full max-w-md flex-col items-center">
					<img
						src={helmorLogoSrc}
						alt="Helmor"
						draggable={false}
						className="size-18 rounded-[11px] opacity-90"
					/>

					{identityState.status === "checking" ? (
						<div className="mt-10 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground">
							<RefreshCw className="size-4 animate-spin" strokeWidth={1.8} />
							Checking GitHub CLI
						</div>
					) : identityState.status === "pending" ? (
						<div className="mt-10 flex flex-col items-center gap-4 text-center">
							<div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
								<Terminal className="size-4" strokeWidth={1.8} />
								Complete GitHub CLI auth in Terminal
							</div>
							<Button variant="ghost" size="sm" onClick={onCancelGithubConnect}>
								Cancel
							</Button>
						</div>
					) : (
						<div className="mt-10 flex w-full max-w-sm flex-col items-center gap-4 text-center">
							{message ? (
								<p className="text-sm text-muted-foreground">{message}</p>
							) : null}
							<Button
								onClick={onConnectGithub}
								size="lg"
								className="hover:bg-primary/90"
							>
								<GithubBrandIcon size={16} data-icon="inline-start" />
								{identityState.status === "error"
									? "Retry GitHub CLI"
									: "Connect GitHub CLI"}
							</Button>
						</div>
					)}
				</div>
			</div>

			<figure className="absolute inset-x-0 bottom-16 z-10 flex items-baseline justify-center gap-2 px-6">
				<span
					aria-hidden
					className="font-serif text-3xl leading-none text-muted-foreground/40"
				>
					&ldquo;
				</span>
				<blockquote className="whitespace-nowrap font-serif text-lg italic leading-snug text-foreground/70">
					<TypingAnimation
						text={[
							{ text: "AI made me 10x. " },
							{
								text: "Helmor",
								className: "font-bold text-foreground",
							},
							{
								text: " takes me 100x. Goodbye, handcrafted code. 👋",
							},
						]}
						duration={55}
						delay={400}
					/>
				</blockquote>
			</figure>
		</main>
	);
}
