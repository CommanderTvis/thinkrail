import type {Model} from './HostClient';
import {commandScore} from './commandScore';

type ModelPickerGroup = {kind: 'default'} | {kind: 'provider'; provider: string; models: Model[]};

export function modelPickerGroups(models: readonly Model[], query: string, defaultLabel?: string): ModelPickerGroup[] {
  const groups = new Map<string, {models: {model: Model; score: number}[]; score: number}>();
  for (const model of models) {
    const score = query ? commandScore(`${model.provider} ${model.name} ${model.id}`.trim(), query) : 1;
    if (!score) continue;
    const group = groups.get(model.provider) ?? {models: [], score: 0};
    group.models.push({model, score});
    group.score = Math.max(group.score, score);
    groups.set(model.provider, group);
  }
  const ranked: {group: ModelPickerGroup; score: number}[] = [];
  if (defaultLabel !== undefined) {
    const score = query ? commandScore(defaultLabel.trim(), query) : 1;
    if (score) ranked.push({group: {kind: 'default'}, score});
  }
  for (const [provider, group] of groups) {
    group.models.sort((a, b) => b.score - a.score);
    ranked.push({group: {kind: 'provider', provider, models: group.models.map(entry => entry.model)}, score: group.score});
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(entry => entry.group);
}
