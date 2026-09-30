import {expect, test} from 'bun:test';
import {activitySteps, activitySummary, hydrateToolResults, thinkingHeading, toolSummary, updateToolResults} from './chatActivityModel.ts';
import {parseToolResultContent} from './toolResultContent.ts';

const tool = (id, name, args = {}) => ({type: 'toolCall', id, name, arguments: args});
const text = value => ({type: 'text', text: value});

test('tools nest under their preceding thought and summaries count flattened steps', () => {
  const blocks = [tool('1', 'read'), {type: 'thinking', thinking: '**Plan**\nCheck files'}, tool('2', 'read'), tool('3', 'edit')];
  const before = JSON.stringify(blocks);
  const steps = activitySteps(blocks, 'row');
  expect(steps).toHaveLength(2);
  expect(steps[1].tools.map(step => step.id)).toEqual(['2', '3']);
  expect(activitySummary(steps, false, '')).toBe('4 steps · read ×2, thinking, edit');
  expect(JSON.stringify(blocks)).toBe(before);
});

test('live summaries show the current command or workspace-relative path', () => {
  const steps = activitySteps([tool('1', 'read', {path: '/work/repo/src/main.ts'})], 'row');
  expect(activitySummary(steps, true, '/work/repo/')).toBe('read · src/main.ts');
  expect(toolSummary({...steps[0], args: {path: '/work/repository/main.ts'}}, '/work/repo')).toBe('/work/repository/main.ts');
  expect(activitySummary(activitySteps([tool('2', 'bash', {command: 'git status'})], 'row'), true, '')).toBe('bash · git status');
  expect(activitySummary(activitySteps([{type: 'thinking', thinking: 'plan'}], 'row'), true, '')).toBe('Thinking…');
});

test('thinking headings accept only the original whole-line bold formats', () => {
  expect(thinkingHeading('\n**Check the files**\nDetails')).toBe('Check the files');
  expect(thinkingHeading('__Plan__')).toBe('Plan');
  for (const value of ['plain text', '***Plan***', '** Plan **', '**one** and **two**']) expect(thinkingHeading(value)).toBeUndefined();
});

test('partial tool results replace earlier output and leave other tools unchanged', () => {
  const initial = {other: {status: 'done', raw: {content: [text('other')]}}};
  const started = updateToolResults(initial, {type: 'tool_execution_start', toolCallId: '1'});
  const first = updateToolResults(started, {type: 'tool_execution_update', toolCallId: '1', partialResult: {content: [text('old')]}});
  const next = updateToolResults(first, {type: 'tool_execution_update', toolCallId: '1', partialResult: {content: [text('new')]}});
  expect(parseToolResultContent(next['1'].raw).text).toBe('new');
  expect(parseToolResultContent(first['1'].raw).text).toBe('old');
  expect(next.other).toBe(initial.other);
  expect(initial['1']).toBeUndefined();
  expect(updateToolResults(next, {type: 'agent_start'})).toBe(next);
});

test('completed and hydrated tool results retain errors and exact output', () => {
  const raw = {content: [text('failed'), text('details')], details: {exitCode: 1}};
  const ended = updateToolResults({}, {type: 'tool_execution_end', toolCallId: '1', result: raw, isError: true});
  expect(ended['1']).toEqual({status: 'error', raw});
  expect(parseToolResultContent(ended['1'].raw).text).toBe('faileddetails');
  const message = {role: 'toolResult', toolCallId: '1', isError: true, ...raw};
  const hydrated = hydrateToolResults([{role: 'user', content: 'question'}, message, {role: 'toolResult', toolCallId: '2', content: []}]);
  expect(hydrated['1']).toEqual({status: 'error', raw: message});
  expect(hydrated['2'].status).toBe('done');
  expect(Object.keys(hydrated)).toEqual(['1', '2']);
});
