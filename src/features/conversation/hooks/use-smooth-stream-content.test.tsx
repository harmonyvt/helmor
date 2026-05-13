import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSmoothStreamContent } from "./use-smooth-stream-content";

describe("useSmoothStreamContent", () => {
	it("returns content immediately while streaming", () => {
		const fullText =
			"明白。后续我会直接在本地原始仓库修改：\n\n`/Users/aidan/mi/mihome/miot-plugin-sdk/projects/com.xiaomi.robovac`\n\n不再先改 Helmor worktree 再复制。";

		const { result, rerender } = renderHook(
			({ content, enabled }: { content: string; enabled: boolean }) =>
				useSmoothStreamContent(content, { enabled }),
			{ initialProps: { content: "", enabled: true } },
		);

		expect(result.current).toBe("");

		rerender({ content: fullText, enabled: true });
		expect(result.current).toBe(fullText);
	});

	it("returns content immediately when streaming is disabled", () => {
		const fullText = "Hello world";

		const { result, rerender } = renderHook(
			({ content, enabled }: { content: string; enabled: boolean }) =>
				useSmoothStreamContent(content, { enabled }),
			{ initialProps: { content: "", enabled: true } },
		);

		rerender({ content: fullText, enabled: false });
		expect(result.current).toBe(fullText);
	});
});
