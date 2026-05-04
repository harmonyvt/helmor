import {
	AuthStorage,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { bootstrapPiAuth } from "./pi-auth-bootstrap.js";

export interface PiRuntimeResources {
	readonly authStorage: AuthStorage;
	readonly modelRegistry: ModelRegistry;
	readonly resourceLoader: ResourceLoader;
}

export async function createPiRuntimeResources(
	cwd: string | undefined,
): Promise<PiRuntimeResources> {
	const authStorage = AuthStorage.create();
	bootstrapPiAuth(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage);
	const effectiveCwd = cwd || process.cwd();
	const resourceLoader = new DefaultResourceLoader({
		cwd: effectiveCwd,
		agentDir: getAgentDir(),
	});
	await resourceLoader.reload();

	return { authStorage, modelRegistry, resourceLoader };
}
