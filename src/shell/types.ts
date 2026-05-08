import type { GithubCliStatus } from "@/lib/api";

export type GithubCliIdentitySession = {
	provider: "gh-cli";
	login: string;
	version: string;
};

export type GithubIdentityState =
	| { status: "checking" }
	| { status: "pending" }
	| { status: "connected"; session: GithubCliIdentitySession }
	| { status: "disconnected"; cliStatus?: GithubCliStatus }
	| { status: "error"; message: string; cliStatus?: GithubCliStatus };
