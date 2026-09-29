import type {
	ReviewCommentingCallbacks,
	ReviewThreadActions,
	ReviewThreadData,
} from "./reviewWidgets";

export interface SideReview {
	threads: ReviewThreadData[];
	commenting: ReviewCommentingCallbacks;
	focus: { id: string; line: number } | null;
}

export interface EditorReview extends SideReview {
	actions: ReviewThreadActions;
	onFocusHandled: () => void;
	base: SideReview;
}
