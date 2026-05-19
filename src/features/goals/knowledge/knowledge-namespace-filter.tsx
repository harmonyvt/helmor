import { cn } from "@/lib/utils";

type Namespace = "all" | "project" | "goal";

type KnowledgeNamespaceFilterProps = {
	value: Namespace;
	onChange: (v: Namespace) => void;
};

const TABS: { id: Namespace; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "project", label: "Project" },
	{ id: "goal", label: "Goal" },
];

export function KnowledgeNamespaceFilter({
	value,
	onChange,
}: KnowledgeNamespaceFilterProps) {
	return (
		<div className="flex gap-1">
			{TABS.map((tab) => {
				const isActive = value === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						onClick={() => onChange(tab.id)}
						className={cn(
							"h-6 rounded-full border px-2.5 text-xs font-medium cursor-pointer transition-colors",
							isActive
								? "bg-primary/10 text-primary border-primary/30"
								: "bg-muted/25 text-muted-foreground border-border/40 hover:bg-accent/60 hover:text-foreground",
						)}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
