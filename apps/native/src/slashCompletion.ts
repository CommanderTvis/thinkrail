import type {SlashCommandInfo, TemplateInfo} from '../../../packages/contracts/src';

export type SlashCommandItem = Omit<SlashCommandInfo, "source"> & {
  source: SlashCommandInfo["source"] | "builtin";
};

const MAX_MATCHES = 8;
export async function slashCommandCatalogOrEmpty(
  load: () => Promise<SlashCommandInfo[]>,
): Promise<SlashCommandInfo[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}

export function slashCommandQuery(value: string): string | null {
  return value.startsWith("/") && !/\s/.test(value) ? value.slice(1) : null;
}

export function matchSlashCommands<T extends SlashCommandItem>(
  value: string,
  commands: readonly T[],
): T[] {
  const query = slashCommandQuery(value);
  if (query === null) return [];
  const normalized = query.toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().includes(normalized))
    .slice(0, MAX_MATCHES);
}

export function selectedSlashCommandValue(command: SlashCommandItem): string {
  return `/${command.name} `;
}

export function templateToSlashCommand(template: TemplateInfo): SlashCommandInfo {
  return {
    name: template.name,
    ...(template.description ? { description: template.description } : {}),
    source: "prompt",
    sourceInfo: {
      path: template.filePath,
      source: "local",
      scope: template.scope === "global" ? "user" : "project",
      origin: "top-level",
    },
  };
}

export type SlashCompletionKeyAction =
  | { type: "none" }
  | { type: "move"; index: number }
  | { type: "select"; index: number }
  | { type: "dismiss" };

export function slashCompletionKeyAction(
  key: string,
  open: boolean,
  activeIndex: number,
  matchCount: number,
): SlashCompletionKeyAction {
  if (!open || matchCount === 0) return { type: "none" };
  if (key === "ArrowDown") return { type: "move", index: (activeIndex + 1) % matchCount };
  if (key === "ArrowUp") {
    return { type: "move", index: (activeIndex - 1 + matchCount) % matchCount };
  }
  if (key === "Enter" || key === "Tab") return { type: "select", index: activeIndex };
  if (key === "Escape") return { type: "dismiss" };
  return { type: "none" };
}

export function shouldApplyTemplatePick(pick: {
  generation: number;
  latestGeneration: number;
  draftAtPick: string;
  currentDraft: string;
  contextAtPick: string;
  currentContext: string;
}): boolean {
  return (
    pick.generation === pick.latestGeneration &&
    pick.draftAtPick === pick.currentDraft &&
    pick.contextAtPick === pick.currentContext
  );
}


export function nativeEditCaret(oldValue: string, newValue: string, selection: {start: number; end: number}): number {
  const before = oldValue.slice(0, selection.start), after = oldValue.slice(selection.end);
  if (newValue.startsWith(before) && newValue.endsWith(after) && newValue.length >= before.length + after.length) return newValue.length - after.length;
  let start = 0;
  while (start < oldValue.length && start < newValue.length && oldValue[start] === newValue[start]) start++;
  let suffix = 0;
  while (suffix < oldValue.length - start && suffix < newValue.length - start && oldValue[oldValue.length - 1 - suffix] === newValue[newValue.length - 1 - suffix]) suffix++;
  return newValue.length - suffix;
}
