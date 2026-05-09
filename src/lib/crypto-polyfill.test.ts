import { afterEach, describe, expect, it, vi } from "vitest";
import { installCryptoRandomUUIDPolyfill } from "./crypto-polyfill";

const originalCrypto = globalThis.crypto;

afterEach(() => {
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: originalCrypto,
	});
	vi.restoreAllMocks();
});

describe("installCryptoRandomUUIDPolyfill", () => {
	it("adds randomUUID when browser crypto lacks it", () => {
		let nextByte = 0;
		const cryptoWithoutRandomUuid = {
			getRandomValues(bytes: Uint8Array) {
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = nextByte;
					nextByte += 1;
				}
				return bytes;
			},
		};
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: cryptoWithoutRandomUuid,
		});

		installCryptoRandomUUIDPolyfill();

		expect(globalThis.crypto.randomUUID()).toBe(
			"00010203-0405-4607-8809-0a0b0c0d0e0f",
		);
	});

	it("keeps a native randomUUID implementation", () => {
		const randomUUID = vi.fn(() => "native-id");
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: { randomUUID },
		});

		installCryptoRandomUUIDPolyfill();

		expect(globalThis.crypto.randomUUID()).toBe("native-id");
		expect(randomUUID).toHaveBeenCalledTimes(1);
	});
});
