import type { MessagePart } from "./api";

export function renderParts(parts: MessagePart[]) {
	return parts.map((part, index) => {
		const key = part.id ?? `${part.type}-${index}`;
		if (part.type === "text" && typeof part.text === "string") {
			return <p key={key}>{part.text}</p>;
		}
		if (part.type === "reasoning" && typeof part.text === "string") {
			return (
				<details key={key}>
					<summary>Reasoning</summary>
					<p>{part.text}</p>
				</details>
			);
		}
		if (part.type === "system-notice") {
			return (
				<p key={key} className="notice">
					{String(part.label ?? "Notice")}
					{part.body ? `: ${String(part.body)}` : ""}
				</p>
			);
		}
		if (part.type === "tool-call") {
			return (
				<p key={key} className="tool">
					{String(part.toolName ?? part.tool_name ?? "Tool")}
				</p>
			);
		}
		if (part.type === "collapsed-group") {
			return (
				<p key={key} className="tool">
					{String(part.summary ?? "Tool activity")}
				</p>
			);
		}
		return (
			<p key={key} className="tool">
				{part.type}
			</p>
		);
	});
}
