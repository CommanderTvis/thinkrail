export type ComposerGrowth = 'compact' | 'roomy' | 'half-chat';

export function composerInputHeight(contentHeight: number, chatHeight: number, growth: ComposerGrowth): number {
  const limit = growth === 'compact' ? 6 * 20 + 16
    : growth === 'roomy' ? 10 * 20 + 16 : Math.max(36, chatHeight / 2 - 48);
  return Math.max(36, Math.min(Math.ceil(contentHeight), limit));
}
