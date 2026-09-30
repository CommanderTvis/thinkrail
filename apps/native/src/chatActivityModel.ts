import type {ChatMessage} from './HostClient';
import {toolFileReference} from './toolFilePaths';

export type ToolResult = {status: 'running' | 'done' | 'error'; raw: unknown};
export type ToolResults = Record<string, ToolResult>;
export type ToolStep = {kind: 'tool'; id: string; name: string; args: Record<string, unknown>};
export type ThinkingStep = {kind: 'thinking'; id: string; text: string; tools: ToolStep[]};
export type ActivityStep = ToolStep | ThinkingStep;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function activitySteps(content: unknown, rowId: string): ActivityStep[] {
  const steps: ActivityStep[] = [];
  let thought: ThinkingStep | undefined;
  if (!Array.isArray(content)) return steps;
  content.forEach((value, index) => {
    const block = record(value);
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      thought = {kind: 'thinking', id: `${rowId}:thinking:${index}`, text: block.thinking, tools: []};
      steps.push(thought);
    } else if (block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string') {
      const tool: ToolStep = {kind: 'tool', id: block.id, name: block.name, args: record(block.arguments)};
      if (thought) thought.tools.push(tool);
      else steps.push(tool);
    }
  });
  return steps;
}

export function toolSummary(step: ToolStep, root: string): string {
  if (step.name === 'bash') return typeof step.args.command === 'string' ? step.args.command : '';
  const path = step.args.path;
  if (typeof path !== 'string') return '';
  return toolFileReference(path, root).label;
}

export function activitySummary(steps: ActivityStep[], live: boolean, root: string): string {
  const flat = steps.flatMap(step => step.kind === 'thinking' ? [step, ...step.tools] : [step]);
  const current = flat.at(-1);
  if (live) {
    if (!current) return 'Working…';
    if (current.kind === 'thinking') return 'Thinking…';
    const summary = toolSummary(current, root);
    return summary ? `${current.name} · ${summary}` : `${current.name}…`;
  }
  const counts = new Map<string, number>();
  for (const step of flat) {
    const name = step.kind === 'thinking' ? 'thinking' : step.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name);
  return `${flat.length} ${flat.length === 1 ? 'step' : 'steps'} · ${names.slice(0, 4).join(', ')}${names.length > 4 ? `, +${names.length - 4} more` : ''}`;
}

export function thinkingHeading(text: string): string | undefined {
  const line = text.split(/\r?\n/).find(value => value.trim())?.trim();
  if (!line) return undefined;
  for (const delimiter of ['**', '__']) {
    if (!line.startsWith(delimiter) || !line.endsWith(delimiter)) continue;
    if (line[2] === delimiter[0] || line.at(-3) === delimiter[0]) return undefined;
    const heading = line.slice(2, -2);
    return heading && heading === heading.trim() && !heading.includes(delimiter) ? heading : undefined;
  }
  return undefined;
}

export function hydrateToolResults(messages: ChatMessage[]): ToolResults {
  const results: ToolResults = {};
  for (const message of messages) {
    const result = record(message);
    if (result.role === 'toolResult' && typeof result.toolCallId === 'string') {
      results[result.toolCallId] = {status: result.isError ? 'error' : 'done', raw: message};
    }
  }
  return results;
}

export function updateToolResults(results: ToolResults, event: Record<string, unknown>): ToolResults {
  if (typeof event.toolCallId !== 'string') return results;
  let result: ToolResult;
  if (event.type === 'tool_execution_start') result = {status: 'running', raw: undefined};
  else if (event.type === 'tool_execution_update') result = {status: 'running', raw: event.partialResult};
  else if (event.type === 'tool_execution_end') result = {status: event.isError ? 'error' : 'done', raw: event.result};
  else return results;
  return {...results, [event.toolCallId]: result};
}
