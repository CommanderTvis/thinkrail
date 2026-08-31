export interface AddReviewCommentParams {
	path: string;
	startLine: number;
	endLine?: number;
	body: string;
}

export interface ReviewVerdictParams {
	todoId: string;
	verdict: "approve" | "request_changes";
	note?: string;
}

export interface ReflectFindingParams {
	commentId: string;
	verdict: "kept" | "refuted";
	confidence: "low" | "medium" | "high";
	reason: string;
}

function unavailable(): never {
	throw new Error("Plan review is not available on this host.");
}

let addReviewComment: (sessionId: string, params: AddReviewCommentParams) => unknown = unavailable;
let reviewVerdict: (sessionId: string, params: ReviewVerdictParams) => unknown = unavailable;
let reflectFinding: (sessionId: string, params: ReflectFindingParams) => unknown = unavailable;

export function setAddReviewCommentHandler(
	fn: (sessionId: string, params: AddReviewCommentParams) => unknown,
): void {
	addReviewComment = fn;
}

export function setReviewVerdictHandler(
	fn: (sessionId: string, params: ReviewVerdictParams) => unknown,
): void {
	reviewVerdict = fn;
}

export function setReflectFindingHandler(
	fn: (sessionId: string, params: ReflectFindingParams) => unknown,
): void {
	reflectFinding = fn;
}

export function callAddReviewComment(sessionId: string, params: AddReviewCommentParams): unknown {
	return addReviewComment(sessionId, params);
}

export function callReviewVerdict(sessionId: string, params: ReviewVerdictParams): unknown {
	return reviewVerdict(sessionId, params);
}

export function callReflectFinding(sessionId: string, params: ReflectFindingParams): unknown {
	return reflectFinding(sessionId, params);
}
