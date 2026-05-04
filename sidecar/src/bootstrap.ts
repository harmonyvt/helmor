import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function prependPath(path: string): void {
	const delimiter = process.platform === "win32" ? ";" : ":";
	const current = process.env.PATH?.trim();
	process.env.PATH = current ? `${path}${delimiter}${current}` : path;
}

function configureBundledPiRuntime(): void {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const executableDir = dirname(process.execPath);
	const vendorPiDir = existsSync(join(executableDir, "vendor", "pi"))
		? join(executableDir, "vendor", "pi")
		: join(moduleDir, "vendor", "pi");
	const packageDir =
		process.env.HELMOR_PI_PACKAGE_DIR || join(vendorPiDir, "package");
	const binDir = process.env.HELMOR_PI_BIN_DIR || join(vendorPiDir, "bin");

	if (existsSync(join(packageDir, "package.json"))) {
		process.env.PI_PACKAGE_DIR ??= packageDir;
		process.env.PI_SKIP_VERSION_CHECK ??= "1";
	}

	if (existsSync(binDir)) {
		process.env.HELMOR_PI_BIN_DIR ??= binDir;
		prependPath(binDir);
	}
}

configureBundledPiRuntime();
await import("./index.js");
