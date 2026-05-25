import type { CodeGraphNode } from "@/lib/api";

export function canOpenNodeDiff(
	node: CodeGraphNode,
): node is CodeGraphNode & { status: NonNullable<CodeGraphNode["status"]> } {
	return !node.isExternal && node.status !== null;
}

export function canOpenNodeFile(node: CodeGraphNode): boolean {
	return !node.isExternal && node.status !== "D";
}

export function resolveNodeEditorPath(
	nodePath: string,
	workspaceRootPath?: string | null,
): string {
	if (isAbsolutePath(nodePath) || !workspaceRootPath) {
		return nodePath;
	}

	return `${workspaceRootPath.replace(/\/+$/, "")}/${nodePath.replace(/^\/+/, "")}`;
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}
