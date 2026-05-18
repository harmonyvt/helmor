import { errorDetails } from "./logger";

type WritableStream = {
	write(chunk: string): unknown;
	on?(event: "error", callback: (error: unknown) => void): unknown;
};

type SidecarLogger = {
	error(message: string, details?: Record<string, unknown>): void;
};

export function isBrokenPipeError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "EPIPE"
	);
}

export function createStdoutProtocolWriter(
	stream: WritableStream,
	logger: SidecarLogger,
	exit: (code: number) => void = process.exit,
): (event: object) => void {
	let closed = false;
	const closeForBrokenPipe = (error: unknown) => {
		if (closed) return;
		closed = true;
		logger.error("stdout pipe closed; sidecar exiting", errorDetails(error));
		setImmediate(() => exit(0));
	};

	stream.on?.("error", (error) => {
		if (isBrokenPipeError(error)) {
			closeForBrokenPipe(error);
			return;
		}
		logger.error("stdout stream error", errorDetails(error));
	});

	return (event) => {
		if (closed) return;
		try {
			stream.write(`${JSON.stringify(event)}\n`);
		} catch (error) {
			if (isBrokenPipeError(error)) {
				closeForBrokenPipe(error);
				return;
			}
			throw error;
		}
	};
}
