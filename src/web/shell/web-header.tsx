import type React from "react";

interface WebHeaderProps {
	title: string;
	leftAction?: React.ReactNode;
	rightActions?: React.ReactNode;
}

export function WebHeader({ title, leftAction, rightActions }: WebHeaderProps) {
	return (
		<>
			<div className="web-safe-area-top shrink-0 bg-sidebar" />
			<div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-border bg-sidebar">
				<div className="flex items-center gap-2">
					{leftAction}
					<span className="text-sm font-semibold text-foreground">{title}</span>
				</div>
				{rightActions ? (
					<div className="flex items-center gap-1">{rightActions}</div>
				) : null}
			</div>
		</>
	);
}
