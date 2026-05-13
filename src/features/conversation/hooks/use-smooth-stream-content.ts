type UseSmoothStreamContentOptions = {
	enabled?: boolean;
};

/**
 * Returns content immediately without any artificial throttle.
 *
 * The upstream RAF flush in use-streaming.ts already batches query-cache writes
 * to animation frames, so React re-renders arrive at most once per frame.
 * A second char-by-char animation layer on top only adds lag and visible gaps.
 */
export function useSmoothStreamContent(
	content: string,
	_options: UseSmoothStreamContentOptions = {},
): string {
	return content;
}
