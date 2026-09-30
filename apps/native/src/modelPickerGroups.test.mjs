import {expect, test} from 'bun:test';
import {commandScore as originalScore} from '../../../apps/web/node_modules/cmdk/dist/command-score.js';
import {commandScore} from './commandScore.ts';
import {modelPickerGroups} from './modelPickerGroups.ts';

const model = (provider, name, id = name) => ({provider, name, id, contextWindow: 128000, reasoning: true});

test('native fuzzy scores match the installed original across word breaks, typos, casing and whitespace', () => {
  const values = ['anthropic Claude Sonnet 4 claude-sonnet-4', 'openai GPT-5 gpt-5', 'Default: Claude Sonnet',
    'HTML', 'haml', 'abc', 'aabbc', 'foo/bar_baz+qux.#"@[({&', 'ouch', 'curtain', 'hello-world', 'λ model', '🧠 agent'];
  const queries = ['', 'cs4', 'Sonnet', 'gpt5', 'GPT', 'HM', 'ac', 'aabc', 'uc', 'hw', 'hello world', 'hello\tworld', 'default', 'claude ', ' λ', '🧠', 'zz'];
  for (const value of values) for (const query of queries) {
    expect(commandScore(value, query)).toBe(originalScore(value, query, []));
  }
});

test('fuzzy search ranks rows and provider groups by the original score without mutating the catalog', () => {
  const models = [model('a', 'Cloud Support', 'cloud-support'), model('a', 'Claude Sonnet 4', 'claude-sonnet-4'),
    model('b', 'cs4', 'cs4'), model('c', 'Unrelated', 'other')];
  const before = structuredClone(models);
  const groups = modelPickerGroups(models, 'cs4');
  expect(groups.map(group => group.provider)).toEqual(['b', 'a']);
  expect(groups[1].models.map(item => item.name)).toEqual(['Claude Sonnet 4']);
  expect(models).toEqual(before);
});

test('empty queries and tied scores retain catalog order, including the reviewer default group', () => {
  const models = [model('second', 'Same', 'same'), model('first', 'Same', 'same'), model('second', 'Later', 'later')];
  expect(modelPickerGroups(models, '', 'Default').map(group => group.kind === 'default' ? 'default' : group.provider)).toEqual(['default', 'second', 'first']);
  expect(modelPickerGroups(models, '')[0].models).toEqual([models[0], models[2]]);
  const tied = [model('a', 'Same', 'same'), model('b', 'Same', 'same')];
  expect(modelPickerGroups(tied, 'same').map(group => group.provider)).toEqual(['a', 'b']);
});

test('default options participate in fuzzy group ranking and unmatched groups disappear', () => {
  const models = [model('a', 'Default', 'default')];
  expect(modelPickerGroups(models, 'Default', 'Default')[0]).toEqual({kind: 'default'});
  expect(modelPickerGroups(models, 'Default', 'Inherit default fallback').map(group => group.kind)).toEqual(['provider', 'default']);
  expect(modelPickerGroups(models, 'zz', 'Default')).toEqual([]);
  expect(modelPickerGroups([], '', 'Default')).toEqual([{kind: 'default'}]);
  expect(modelPickerGroups([], '', '')).toEqual([{kind: 'default'}]);
});
