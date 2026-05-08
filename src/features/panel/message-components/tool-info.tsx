import {
	Bot,
	ClipboardCheck,
	ClipboardList,
	FilePlus,
	FileText,
	FileX,
	FolderSearch,
	Globe,
	MessageSquareMore,
	MessageSquareText,
	Pencil,
	Plug,
	Search,
	Sparkles,
	Terminal,
} from "lucide-react";
import type { ToolInfo } from "./shared";
import { basename, isObj, str, truncate } from "./shared";

const fallbackIcon = (
	<span className="size-3.5 rounded-full bg-foreground/15" />
);
const neutralToolIconClassName = "size-3.5 text-muted-foreground";

function getPiToolInfo(
	tool: string,
	input: Record<string, unknown> | null,
): ToolInfo | null {
	if (tool === "read") {
		const filePath = str(input?.path) ?? str(input?.file_path);
		const limit = typeof input?.limit === "number" ? input.limit : null;
		return {
			action: limit ? `Read ${limit} lines` : "Read",
			file: filePath ? basename(filePath) : undefined,
			icon: <FileText className={neutralToolIconClassName} strokeWidth={1.8} />,
		};
	}

	if (tool === "bash") {
		const command = str(input?.command) ?? str(input?.cmd);
		return {
			action: "Run",
			icon: <Terminal className={neutralToolIconClassName} strokeWidth={1.8} />,
			command: command ? truncate(command, 80) : undefined,
			fullCommand: command ?? undefined,
		};
	}

	if (tool === "grep") {
		const pattern = str(input?.pattern) ?? str(input?.query);
		return {
			action: "Grep",
			icon: <Search className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: pattern ?? undefined,
		};
	}

	if (tool === "find") {
		const pattern = str(input?.pattern) ?? str(input?.name) ?? str(input?.path);
		return {
			action: "Find",
			icon: (
				<FolderSearch className={neutralToolIconClassName} strokeWidth={1.8} />
			),
			detail: pattern ?? undefined,
		};
	}

	if (tool === "ls") {
		const path = str(input?.path);
		return {
			action: "List",
			file: path ? basename(path) : undefined,
			icon: (
				<FolderSearch className={neutralToolIconClassName} strokeWidth={1.8} />
			),
		};
	}

	const kanbanLabels: Record<string, string> = {
		list_kanban_cards: "List cards",
		create_kanban_card: "Create card",
		move_kanban_card: "Move card",
		update_kanban_card: "Update card",
	};
	if (kanbanLabels[tool]) {
		return {
			action: kanbanLabels[tool],
			icon: (
				<ClipboardList className={neutralToolIconClassName} strokeWidth={1.8} />
			),
			detail: str(input?.title) ?? str(input?.lane) ?? undefined,
		};
	}

	const threadLabels: Record<string, string> = {
		list_threads: "List threads",
		create_thread: "Create thread",
		get_thread: "Read thread",
		update_thread: "Update thread",
	};
	if (threadLabels[tool]) {
		return {
			action: threadLabels[tool],
			icon: (
				<MessageSquareText
					className={neutralToolIconClassName}
					strokeWidth={1.8}
				/>
			),
			detail: str(input?.title) ?? str(input?.threadId) ?? undefined,
		};
	}

	return null;
}

export function getToolInfo(
	name: string,
	input: Record<string, unknown> | null,
): ToolInfo {
	if (name.startsWith("mcp__")) {
		const segments = name.split("__");
		const server = segments[1] ?? "mcp";
		const tool = segments.slice(2).join("__") || name;
		const piInfo = server === "pi" ? getPiToolInfo(tool, input) : null;
		if (piInfo) return piInfo;
		return {
			action: tool,
			icon: <Plug className="size-3.5 text-chart-2" strokeWidth={1.8} />,
			detail: `via ${server}`,
		};
	}

	if (!input) {
		return { action: name, icon: fallbackIcon };
	}

	if (name === "Edit") {
		const filePath = str(input.file_path);
		const oldStr = typeof input.old_string === "string" ? input.old_string : "";
		const newStr = typeof input.new_string === "string" ? input.new_string : "";
		const diffDelete = oldStr ? oldStr.split("\n").length : 0;
		const diffAdd = newStr ? newStr.split("\n").length : 0;
		return {
			action: "Edit",
			file: filePath ? basename(filePath) : undefined,
			icon: <Pencil className={neutralToolIconClassName} strokeWidth={1.8} />,
			diffAdd,
			diffDel: diffDelete,
		};
	}

	if (name === "apply_patch") {
		const changes = Array.isArray(input.changes) ? input.changes : [];
		const parsed = changes.filter(isObj).map((c) => {
			const path = str(c.path);
			const diff = typeof c.diff === "string" ? c.diff : "";
			let add = 0;
			let del = 0;
			for (const line of diff.split("\n")) {
				if (line.startsWith("+") && !line.startsWith("+++")) add++;
				else if (line.startsWith("-") && !line.startsWith("---")) del++;
			}
			return {
				name: path ? basename(path) : "unknown",
				kind: str(c.kind),
				diffAdd: add || undefined,
				diffDel: del || undefined,
				rawDiff: diff || undefined,
			};
		});
		const totalAdd = parsed.reduce((s, f) => s + (f.diffAdd ?? 0), 0);
		const totalDel = parsed.reduce((s, f) => s + (f.diffDel ?? 0), 0);
		const singleKind = parsed[0]?.kind;
		const singleAction =
			singleKind === "delete" || singleKind === "remove"
				? "Delete"
				: singleKind === "create" || singleKind === "write"
					? "Write"
					: "Edit";
		const singleIcon =
			singleAction === "Delete" ? (
				<FileX className={neutralToolIconClassName} strokeWidth={1.8} />
			) : singleAction === "Write" ? (
				<FilePlus className={neutralToolIconClassName} strokeWidth={1.8} />
			) : (
				<Pencil className={neutralToolIconClassName} strokeWidth={1.8} />
			);
		const icon = (
			<Pencil className={neutralToolIconClassName} strokeWidth={1.8} />
		);

		if (parsed.length <= 1) {
			return {
				action: singleAction,
				file: parsed[0]?.name,
				icon: singleIcon,
				diffAdd: totalAdd || undefined,
				diffDel: totalDel || undefined,
				rawDiff: parsed[0]?.rawDiff,
			};
		}
		return {
			action: `Edit ${parsed.length} files`,
			icon,
			diffAdd: totalAdd || undefined,
			diffDel: totalDel || undefined,
			files: parsed,
		};
	}

	if (name === "Read") {
		const filePath = str(input.file_path);
		const limit = typeof input.limit === "number" ? input.limit : null;
		return {
			action: limit ? `Read ${limit} lines` : "Read",
			file: filePath ? basename(filePath) : undefined,
			icon: <FileText className={neutralToolIconClassName} strokeWidth={1.8} />,
		};
	}

	if (name === "Write") {
		const filePath = str(input.file_path);
		return {
			action: "Write",
			file: filePath ? basename(filePath) : undefined,
			icon: <FilePlus className={neutralToolIconClassName} strokeWidth={1.8} />,
		};
	}

	if (name === "Bash") {
		const command = str(input.command);
		const description = str(input.description);
		return {
			action: description ?? "Run",
			icon: <Terminal className={neutralToolIconClassName} strokeWidth={1.8} />,
			command: command ? truncate(command, 80) : undefined,
			fullCommand: command ?? undefined,
		};
	}

	if (name === "Grep") {
		const pattern = str(input.pattern);
		return {
			action: "Grep",
			icon: <Search className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: pattern ?? undefined,
		};
	}

	if (name === "Glob") {
		const pattern = str(input.pattern);
		return {
			action: "Glob",
			icon: (
				<FolderSearch className={neutralToolIconClassName} strokeWidth={1.8} />
			),
			detail: pattern ?? undefined,
		};
	}

	if (name === "WebFetch") {
		const url = str(input.url);
		return {
			action: "WebFetch",
			icon: <Globe className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: url ? truncate(url, 60) : undefined,
		};
	}

	if (name === "WebSearch") {
		const icon = (
			<Globe className={neutralToolIconClassName} strokeWidth={1.8} />
		);
		const action = isObj(input.action) ? input.action : null;
		const actionType = action ? str(action.type) : null;
		if (actionType === "openPage") {
			const url = str(action!.url);
			return {
				action: "Open page",
				icon,
				detail: url ? truncate(url, 60) : undefined,
			};
		}
		if (actionType === "findInPage") {
			const pattern = str(action!.pattern) ?? str(action!.url);
			return {
				action: "Find in page",
				icon,
				detail: pattern ? truncate(pattern, 60) : undefined,
			};
		}
		const query = str(input.query);
		return {
			action: "WebSearch",
			icon,
			detail: query ? truncate(query, 50) : undefined,
		};
	}

	if (name === "ToolSearch") {
		const query = str(input.query);
		return {
			action: "ToolSearch",
			icon: <Search className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: query ? truncate(query, 50) : undefined,
		};
	}

	if (name === "Agent" || name === "Task") {
		const subagentType = str(input.subagent_type);
		const detail = str(input.description) ?? str(input.prompt);
		return {
			action: subagentType ?? name,
			icon: <Bot className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: detail ? truncate(detail, 60) : undefined,
		};
	}

	if (name === "Prompt") {
		const text = str(input.text);
		return {
			action: "Prompt",
			icon: (
				<MessageSquareText
					className={neutralToolIconClassName}
					strokeWidth={1.8}
				/>
			),
			body: text ?? undefined,
		};
	}

	if (name === "Skill") {
		const skillName =
			str(input.name) ??
			str(input.skill) ??
			str(input.command) ??
			str(input.id);
		return {
			action: "Skill",
			icon: <Sparkles className={neutralToolIconClassName} strokeWidth={1.8} />,
			detail: skillName ? truncate(skillName, 50) : undefined,
		};
	}

	if (
		name === "AskUserQuestion" ||
		name === "askUserQuestions" ||
		name === "vscode_askQuestions"
	) {
		const questions = Array.isArray(input.questions) ? input.questions : [];
		const firstQuestion = questions[0];
		const detail =
			str(input.question) ??
			str(input.prompt) ??
			(isObj(firstQuestion)
				? (str(firstQuestion.question) ?? str(firstQuestion.header))
				: null);
		return {
			action: "Ask user",
			icon: (
				<MessageSquareMore
					className={neutralToolIconClassName}
					strokeWidth={1.8}
				/>
			),
			detail: detail ? truncate(detail, 60) : undefined,
		};
	}

	if (name === "EnterPlanMode") {
		return {
			action: "Enter Plan mode",
			icon: (
				<ClipboardList className={neutralToolIconClassName} strokeWidth={1.8} />
			),
		};
	}

	if (name === "ExitPlanMode") {
		return {
			action: "Exit plan mode",
			icon: (
				<ClipboardCheck
					className={neutralToolIconClassName}
					strokeWidth={1.8}
				/>
			),
		};
	}

	return { action: name, icon: fallbackIcon };
}
