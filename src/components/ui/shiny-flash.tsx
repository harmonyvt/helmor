import { useEffect, useRef, useState } from "react";
import { AnimatedShinyText } from "./animated-shiny-text";

/**
 * Wraps children with a sweeping shimmer animation whenever `active` flips to
 * true. The shimmer runs for 3 × 1 s iterations then auto-clears. Reusing the
 * same `shiny-text-continuous` keyframe as the git file-tree flash so both
 * surfaces feel identical.
 */
export function ShinyFlash({
	active,
	children,
	shimmerWidth = 60,
}: {
	active: boolean;
	children: React.ReactNode;
	shimmerWidth?: number;
}) {
	const [shimmer, setShimmer] = useState(false);
	const counterRef = useRef(0);

	useEffect(() => {
		if (!active) {
			return;
		}
		counterRef.current += 1;
		setShimmer(true);
		const timeoutId = window.setTimeout(() => setShimmer(false), 3000);
		return () => window.clearTimeout(timeoutId);
	}, [active]);

	if (!shimmer) {
		return <span className="truncate">{children}</span>;
	}

	return (
		<AnimatedShinyText
			key={counterRef.current}
			shimmerWidth={shimmerWidth}
			className="!mx-0 !max-w-none truncate !text-neutral-500/80 ![animation-duration:1s] ![animation-iteration-count:3] ![animation-name:shiny-text-continuous] ![animation-timing-function:ease-in-out] dark:!text-neutral-500/80 dark:via-white via-black"
		>
			{children}
		</AnimatedShinyText>
	);
}
