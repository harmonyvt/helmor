import {
	AuthStorage,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { logger } from "./logger.js";
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
	const authBootstrap = bootstrapPiAuth(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage);
	const effectiveCwd = cwd || process.cwd();
	const resourceLoader = new DefaultResourceLoader({
		cwd: effectiveCwd,
		agentDir: getAgentDir(),
	});
	logger.info("Pi runtime resources loading", {
		cwd: effectiveCwd,
		agentDir: getAgentDir(),
		hasPiPackageDir: Boolean(process.env.PI_PACKAGE_DIR),
		piPackageDir: process.env.PI_PACKAGE_DIR ?? null,
		hasPiBinDir: Boolean(process.env.HELMOR_PI_BIN_DIR),
		piBinDir: process.env.HELMOR_PI_BIN_DIR ?? null,
		authAnthropic: authBootstrap.anthropic,
		authOpenAICodex: authBootstrap.openaiCodex,
	});
	await resourceLoader.reload();
	logger.info("Pi runtime resources loaded", {
		cwd: effectiveCwd,
		agentDir: getAgentDir(),
	});

	return { authStorage, modelRegistry, resourceLoader };
}
