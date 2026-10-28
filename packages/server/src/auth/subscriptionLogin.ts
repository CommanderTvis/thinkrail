/**
 * Subscription sign-ins ThinkRail does not offer: pi's Anthropic OAuth logs in to claude.ai as Claude Code,
 * which Anthropic forbids third-party apps to do (JetBrains/thinkrail#437). Its API key stays available.
 */
export const SUBSCRIPTION_LOGIN_DISABLED: ReadonlySet<string> = new Set(["anthropic"]);
