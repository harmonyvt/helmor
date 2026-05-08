interface GroupHeaderProps {
	label: string;
	count: number;
}

export function GroupHeader({ label, count }: GroupHeaderProps) {
	return (
		<div className="flex h-8 items-center justify-between px-4">
			<span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
				{label}
			</span>
			<span className="text-[11px] text-muted-foreground/60">{count}</span>
		</div>
	);
}
