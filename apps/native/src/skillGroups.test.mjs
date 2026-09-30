import {expect, test} from 'bun:test';
import {skillGroups, skillSwitchHint} from './skillGroups.ts';

const entry = (name, group, plugin) => ({name, group, decision: 'load', ...(plugin ? {plugin} : {})});

test('groups order tiers before plugins before the project tier', () => {
  const groups = skillGroups([entry('a', 'project'), entry('b', 'zeta', 'zeta'), entry('c', 'pi'), entry('d', 'bundled'), entry('e', 'alpha', 'alpha'), entry('f', 'personal')]);
  expect(groups.map(group => group.label)).toEqual(['ThinkRail', 'Pi', 'Personal', 'alpha', 'zeta', 'Project']);
  expect(groups.filter(group => group.leading).map(group => group.key)).toEqual(['bundled', 'pi']);
  expect(groups.find(group => group.key === 'alpha')).toMatchObject({isPlugin: true, hint: 'Claude plugin'});
});

test('switch hints describe the next action, a block, or a save in flight', () => {
  expect(skillSwitchHint(true, false)).toBe('On — turn off');
  expect(skillSwitchHint(false, false)).toBe('Off — turn on');
  expect(skillSwitchHint(false, false, 'Off — turn on Pi first')).toBe('Off — turn on Pi first');
  expect(skillSwitchHint(true, true, 'blocked')).toBe('Saving skill settings…');
});
