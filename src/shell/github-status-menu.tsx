import { GithubBrandIcon } from "@/components/brand-icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GithubIdentityState } from "./types";

export function GithubStatusMenu({
	identityState,
}: {
	identityState: Extract<GithubIdentityState, { status: "connected" }>;
}) {
	const identitySession = identityState.session;
	const triggerLabel = identitySession.login;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="GitHub account menu"
				className="inline-flex h-7 items-center gap-2 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
			>
				<Avatar size="sm" className="size-4">
					<AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
						<GithubBrandIcon size={10} />
					</AvatarFallback>
				</Avatar>
				<span className="text-[13px] font-medium text-muted-foreground">
					{triggerLabel}
				</span>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" sideOffset={8}>
				<DropdownMenuItem disabled>Authenticated with gh</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
