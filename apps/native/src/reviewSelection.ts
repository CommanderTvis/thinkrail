import type {AppConfig, Model} from './HostClient';

export type DefaultModel = {model: Model | null; thinkingLevel: string};

export function reviewSelection(config: Pick<AppConfig, 'reviewModel' | 'reviewEffort'> | undefined, fallback: DefaultModel | null) {
  const model = config?.reviewModel ?? null;
  const effortModel = model ?? fallback?.model;
  const defaultLabel = fallback?.model ? `Your default model (${fallback.model.name})` : 'Your default model';
  return {
    model, defaultLabel, label: model?.name ?? defaultLabel,
    levels: effortModel?.thinkingLevels ?? [],
    level: config?.reviewEffort ?? (model ? 'medium' : fallback?.thinkingLevel ?? 'medium'),
  };
}
