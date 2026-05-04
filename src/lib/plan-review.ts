import type { PlanReviewPart, ThreadMessageLike } from "./api";

/** Latest unresolved plan-review card, or null when a user has answered it. */
export function getUnresolvedPlanReview(
	messages: ThreadMessageLike[],
): PlanReviewPart | null {
	let lastPlanIdx = -1;
	let lastPlan: PlanReviewPart | null = null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const plan = messages[i].content?.find(
			(part): part is PlanReviewPart => part.type === "plan-review",
		);
		if (plan) {
			lastPlanIdx = i;
			lastPlan = plan;
			break;
		}
	}
	if (lastPlanIdx === -1) return null;
	for (let i = lastPlanIdx + 1; i < messages.length; i++) {
		if (messages[i].role === "user") return null;
	}
	return lastPlan;
}

/** True when the last plan-review card has no user message after it. */
export function hasUnresolvedPlanReview(
	messages: ThreadMessageLike[],
): boolean {
	return getUnresolvedPlanReview(messages) !== null;
}
