type CryptoWithRandomUUID = Crypto & {
	randomUUID?: () => string;
};

export function installCryptoRandomUUIDPolyfill(): void {
	const cryptoRef = globalThis.crypto as CryptoWithRandomUUID | undefined;
	if (!cryptoRef || typeof cryptoRef.randomUUID === "function") {
		return;
	}

	Object.defineProperty(cryptoRef, "randomUUID", {
		configurable: true,
		value: randomUUID,
	});
}

function randomUUID(): string {
	const bytes = new Uint8Array(16);
	const cryptoRef = globalThis.crypto;
	if (cryptoRef?.getRandomValues) {
		cryptoRef.getRandomValues(bytes);
	} else {
		for (let index = 0; index < bytes.length; index += 1) {
			bytes[index] = Math.floor(Math.random() * 256);
		}
	}

	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	return Array.from(bytes, byteToHex)
		.join("")
		.replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5");
}

function byteToHex(byte: number): string {
	return byte.toString(16).padStart(2, "0");
}

installCryptoRandomUUIDPolyfill();
