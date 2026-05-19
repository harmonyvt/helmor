import { Search, X } from "lucide-react";

type KnowledgeSearchBarProps = {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
};

export function KnowledgeSearchBar({
	value,
	onChange,
	placeholder,
}: KnowledgeSearchBarProps) {
	return (
		<div className="relative flex items-center">
			<Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
			<input
				className="h-8 w-full rounded-md border border-border/60 bg-background pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:border-border focus:ring-1 focus:ring-ring"
				placeholder={placeholder ?? "Search knowledge…"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
			{value.length > 0 && (
				<button
					type="button"
					onClick={() => onChange("")}
					className="absolute right-2 p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}
