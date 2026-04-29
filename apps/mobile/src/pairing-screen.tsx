type PairingScreenProps = {
	draftToken: string;
	onDraftTokenChange: (value: string) => void;
	onPair: () => void;
};

export function PairingScreen({
	draftToken,
	onDraftTokenChange,
	onPair,
}: PairingScreenProps) {
	return (
		<main className="pairing">
			<section>
				<p className="eyebrow">Helmor Mobile</p>
				<h1>Pair this phone</h1>
				<p className="muted">
					Open Settings {"->"} Mobile in Helmor on your Mac, enable access, then
					paste the pairing token here.
				</p>
				<input
					value={draftToken}
					onChange={(event) => onDraftTokenChange(event.target.value)}
					placeholder="Pairing token"
					autoCapitalize="none"
					autoCorrect="off"
				/>
				<button type="button" onClick={onPair}>
					Pair
				</button>
			</section>
		</main>
	);
}
