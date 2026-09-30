import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {assembleTemplate, loadTemplateGroups, starterTemplates, templatePopoverPlacement, validTemplateName} from './templateModel';
import {stripFrontmatter} from './frontmatter';

test('Settings requests global templates without workspace shadowing and project templates in their workspace', async () => {
  const global = {name: 'review', scope: 'global', description: 'Global review'};
  const project = {name: 'review', scope: 'project', description: 'Project review'};
  const requests = [];
  const groups = await loadTemplateGroups(async workspaceId => {
    requests.push(workspaceId);
    return {templates: workspaceId ? [project] : [global]};
  }, 'workspace');
  expect(requests).toEqual([undefined, 'workspace']);
  expect(groups).toEqual({global: [global], project: [project]});
});

test('without a workspace Settings only fetches global templates; failed scope reads reject the combined list', async () => {
  const requests = [];
  expect(await loadTemplateGroups(async id => {requests.push(id); return {templates: []};})).toEqual({global: [], project: []});
  expect(requests).toEqual([undefined]);
  await expect(loadTemplateGroups(async id => {
    if (id) throw new Error('Project unavailable');
    return {templates: []};
  }, 'workspace')).rejects.toThrow('Project unavailable');
});

test('template metadata safely round trips quoted strings and authored frontmatter-like bodies', () => {
  const body = '---\nAuthored separator\n---\n\nKeep this text.';
  expect(stripFrontmatter(assembleTemplate('', '', body))).toBe(body);
  expect(assembleTemplate(' "quoted"\nnext ', ' [file] ', 'Body')).toBe('---\ndescription: "\\\"quoted\\\"\\nnext"\nargument-hint: "[file]"\n---\n\nBody');
  let content = assembleTemplate('Description', '', 'A body');
  for (let i = 0; i < 3; i++) content = assembleTemplate('Revised', '', stripFrontmatter(content));
  expect(stripFrontmatter(content)).toBe('A body');
  expect(assembleTemplate(' ', '', 'plain body')).toBe('plain body');
});

test('template name validation rejects traversal, hidden paths and null bytes', () => {
  for (const name of ['', '.hidden', '..', '../x', 'a/b', 'a\\b', 'a\0b']) expect(validTemplateName(name)).toBe(false);
  for (const name of ['review', 'daily-review', 'résumé', 'review.v2']) expect(validTemplateName(name)).toBe(true);
});

test('offered starters preserve the original UI names, metadata and prompt bodies', async () => {
  const original = readFileSync(new URL('../../../apps/web/src/panels/TemplatesSettings.tsx', import.meta.url), 'utf8');
  const constant = original.slice(original.indexOf('const STARTER_TEMPLATES:'), original.indexOf('function StarterTemplatesOffer'));
  const module = new Bun.Transpiler({loader: 'ts'}).transformSync(constant.replace('const STARTER_TEMPLATES', 'export const starterTemplates'));
  const reference = await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`);
  expect(starterTemplates).toEqual(reference.starterTemplates);
});

test('delete confirmation aligns to its trigger, flips above when needed and stays within window edges', () => {
  expect(templatePopoverPlacement({x: 700, y: 200, width: 24, height: 24}, {width: 900, height: 720}, 138)).toEqual({left: 436, top: 228});
  expect(templatePopoverPlacement({x: 880, y: 680, width: 24, height: 24}, {width: 900, height: 720}, 138)).toEqual({left: 604, top: 538});
  expect(templatePopoverPlacement({x: 0, y: 0, width: 24, height: 24}, {width: 900, height: 720}, 138)).toEqual({left: 8, top: 28});
});
