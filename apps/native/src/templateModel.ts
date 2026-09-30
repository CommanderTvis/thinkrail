import type {TemplateInfo} from './HostClient';

export async function loadTemplateGroups(list: (workspaceId?: string) => Promise<{templates: TemplateInfo[]}>, workspaceId?: string) {
  const [global, project] = await Promise.all([list(), workspaceId ? list(workspaceId) : Promise.resolve({templates: []})]);
  return {global: global.templates.filter(t => t.scope === 'global'), project: project.templates.filter(t => t.scope === 'project')};
}

export function validTemplateName(name: string) {
  return Boolean(name) && !name.startsWith('.') && !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

export function templatePopoverPlacement(anchor: {x: number; y: number; width: number; height: number}, bounds: {width: number; height: number}, height: number) {
  const below = anchor.y + anchor.height + 4;
  const top = below + height <= bounds.height - 8 ? below : anchor.y - height - 4;
  return {left: Math.max(8, Math.min(anchor.x + anchor.width - 288, bounds.width - 296)), top: Math.max(8, Math.min(top, bounds.height - height - 8))};
}

function normalizeFrontmatterText(value: string): string {
  const withoutBom = value.startsWith("\uFEFF") ? value.slice(1) : value;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function assembleTemplate(description: string, argumentHint: string, body: string): string {
  const lines: string[] = [];
  const d = description.trim();
  const a = argumentHint.trim();
  if (d) lines.push(`description: ${JSON.stringify(d)}`);
  if (a) lines.push(`argument-hint: ${JSON.stringify(a)}`);
  if (lines.length === 0) {
    return normalizeFrontmatterText(body).startsWith("---") ? `---\n---\n\n${body}` : body;
  }
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

export const starterTemplates: ReadonlyArray<{
  name: string;
  description: string;
  argumentHint: string;
  body: string;
}> = [
  {
    name: "review",
    description: "Code review of a file or directory",
    argumentHint: "[path] [focus]",
    body: `Review $1 for correctness, clarity, and maintainability, focusing on \${2:-the riskiest parts}.\nList concrete findings with \`file:line\` references, ordered by severity, and propose a fix for each.`,
  },
  {
    name: "explain",
    description: "Explain how something works in this codebase",
    argumentHint: "[path-or-topic]",
    body: "Explain how $1 works in this codebase: its purpose, the key control and data flow, and what depends on it.\nKeep it concise and point to the load-bearing files and `file:line` locations.",
  },
  {
    name: "tests",
    description: "Write tests for a target",
    argumentHint: "[path]",
    body: "Write tests for $1. Cover the main behavior, the important edge cases, and one failure path.\nMatch the project's existing test conventions and runner, then run them and report the result.",
  },
  {
    name: "commit",
    description: "Write a Conventional Commit message from the staged diff",
    argumentHint: "[scope]",
    body: `Read the staged changes (\`git diff --cached\`) and write a Conventional Commits message.\nUse the type that fits (feat/fix/refactor/docs/test/chore) with scope \${1:-infer it from the files},\nan imperative subject under 72 chars, and a short body explaining the why when it isn't obvious.\nReply with only the commit message.`,
  },
  {
    name: "rename",
    description: "Rename a symbol everywhere (demoes repeated-slot mirroring)",
    argumentHint: "[old] [new]",
    body: "Rename `$1` to `$2` across the codebase: update every definition, reference, and import of `$1`,\nplus any docs or comments that mention `$1`. Keep `$2` consistent everywhere and run the type-checker after.",
  },
];
