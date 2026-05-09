import type { PrComment } from "@/lib/api";

export function buildPrCommentInsertText(comment: PrComment): string {
	const lines: string[] = [];
	lines.push(`PR Comment by @${comment.author}`);
	if (comment.filePath) {
		lines.push(`File: ${comment.filePath}`);
	}
	lines.push(`Status: ${comment.isThreadResolved ? "Resolved" : "Unresolved"}`);
	lines.push("");

	if (comment.body.trim()) {
		for (const line of comment.body.split(/\r?\n/)) {
			lines.push(`> ${line}`);
		}
	} else {
		lines.push("> ");
	}

	lines.push("");
	lines.push(`URL: ${comment.url}`);
	return lines.join("\n");
}

export function buildReviewAllPrompt(comments: PrComment[]): string {
	const inlineUnresolved = comments.filter(
		(comment) => comment.filePath != null && !comment.isThreadResolved,
	);
	const generalComments = comments.filter(
		(comment) => comment.filePath == null,
	);

	const sections: string[] = [
		"Please review and address all outstanding PR review comments.",
	];

	if (inlineUnresolved.length > 0) {
		sections.push("\n## Inline Code Review Comments");
		const byFile = new Map<string, PrComment[]>();
		for (const comment of inlineUnresolved) {
			const filePath = comment.filePath!;
			const fileComments = byFile.get(filePath);
			if (fileComments) {
				fileComments.push(comment);
			} else {
				byFile.set(filePath, [comment]);
			}
		}
		for (const [filePath, fileComments] of byFile) {
			sections.push(`\n### ${filePath}`);
			for (const comment of fileComments) {
				sections.push(`**@${comment.author}**: ${comment.body}`);
			}
		}
	}

	if (generalComments.length > 0) {
		sections.push("\n## General PR Comments");
		for (const comment of generalComments) {
			sections.push(`\n### @${comment.author}`);
			sections.push(comment.body);
		}
	}

	sections.push(
		"\n---\nFor each comment, understand the requested change and implement it. Run the relevant tests to confirm nothing is broken.",
	);

	return sections.join("\n");
}
