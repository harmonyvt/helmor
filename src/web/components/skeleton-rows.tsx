function SkeletonRow() {
	return (
		<div className="flex h-[52px] items-center gap-3 px-4">
			<div className="h-5 w-[3px] shrink-0 animate-pulse rounded-full bg-muted" />
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
				<div className="h-2.5 w-2/5 animate-pulse rounded bg-muted" />
			</div>
			<div className="h-4 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
		</div>
	);
}

export function SkeletonRows() {
	return (
		<>
			<SkeletonRow />
			<SkeletonRow />
			<SkeletonRow />
		</>
	);
}
