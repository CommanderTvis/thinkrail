import {expect, test} from 'bun:test';
import {reviewSelection} from './reviewSelection.ts';

const defaultModel = {id: 'default', provider: 'fixture', name: 'Default', thinkingLevels: ['off', 'high'], contextWindow: 100000, reasoning: true};
const reviewer = {...defaultModel, id: 'reviewer', name: 'Reviewer', thinkingLevels: ['low', 'medium']};

test('inherited review uses host default effort and levels without selecting an explicit model', () => {
  const selected = reviewSelection({}, {model: defaultModel, thinkingLevel: 'high'});
  expect(selected.model).toBeNull();
  expect(selected.label).toBe('Your default model (Default)');
  expect(selected.level).toBe('high');
  expect(selected.levels).toEqual(['off', 'high']);
});

test('an explicit reviewer uses its own levels and medium effort until overridden', () => {
  const fallback = {model: defaultModel, thinkingLevel: 'high'};
  const selected = reviewSelection({reviewModel: reviewer}, fallback);
  expect(selected.label).toBe('Reviewer');
  expect(selected.level).toBe('medium');
  expect(selected.levels).toEqual(['low', 'medium']);
  expect(reviewSelection({reviewModel: reviewer, reviewEffort: 'low'}, fallback).level).toBe('low');
});

test('no default model exposes no thinking choices while retaining the default option', () => {
  const selected = reviewSelection(undefined, {model: null, thinkingLevel: 'off'});
  expect(selected.label).toBe('Your default model');
  expect(selected.levels).toEqual([]);
});
