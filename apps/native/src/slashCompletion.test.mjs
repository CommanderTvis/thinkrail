import { describe, expect, it } from "bun:test";
import {
  matchSlashCommands,
  selectedSlashCommandValue,
  slashCommandCatalogOrEmpty,
  slashCommandQuery,
  slashCompletionKeyAction
} from "./slashCompletion";
function command(name) {
  return {
    name,
    description: `${name} description`,
    source: "skill",
    sourceInfo: {
      path: `/skills/${name}/SKILL.md`,
      source: "fixture",
      scope: "project",
      origin: "top-level"
    }
  };
}
describe("slash command matching", () => {
  it("matches a leading whitespace-free query case-insensitively and caps at eight", () => {
    const commands = Array.from({ length: 10 }, (_, index) => command(`Skill-${index}`));
    expect(matchSlashCommands("/skill-", commands).map((item) => item.name)).toEqual(commands.slice(0, 8).map((item) => item.name));
    expect(slashCommandQuery("hello /skill")).toBeNull();
    expect(matchSlashCommands("/skill arg", commands)).toEqual([]);
  });
  it("uses one insertion format for every caller", () => {
    expect(selectedSlashCommandValue(command("skill:review"))).toBe("/skill:review ");
  });
  it("degrades an empty or failed optional catalog to no matches", async () => {
    expect(await slashCommandCatalogOrEmpty(async () => [])).toEqual([]);
    expect(await slashCommandCatalogOrEmpty(async () => {
      throw Error("host unavailable");
    })).toEqual([]);
  });
});
describe("slash completion keyboard reducer", () => {
  it("wraps arrow navigation", () => {
    expect(slashCompletionKeyAction("ArrowDown", !0, 2, 3)).toEqual({
      type: "move",
      index: 0
    });
    expect(slashCompletionKeyAction("ArrowUp", !0, 0, 3)).toEqual({
      type: "move",
      index: 2
    });
  });
  it("selects on Enter or Tab and dismisses on Escape", () => {
    expect(slashCompletionKeyAction("Enter", !0, 1, 3)).toEqual({
      type: "select",
      index: 1
    });
    expect(slashCompletionKeyAction("Tab", !0, 1, 3)).toEqual({
      type: "select",
      index: 1
    });
    expect(slashCompletionKeyAction("Escape", !0, 1, 3)).toEqual({ type: "dismiss" });
    expect(slashCompletionKeyAction("Enter", !1, 1, 3)).toEqual({ type: "none" });
  });
});

it('native text differences preserve replacements and insertion at a repeated-text caret', async () => {
  const {nativeEditCaret} = await import('./slashCompletion');
  expect(nativeEditCaret('aaa', 'aaaa', {start: 0, end: 0})).toBe(1);
  expect(nativeEditCaret('Read ⟨file⟩ now', 'Read README.md now', {start: 5, end: 11})).toBe(14);
  expect(nativeEditCaret('abcd', 'acd', {start: 2, end: 2})).toBe(1);
  expect(nativeEditCaret('abcd', 'abXYd', {start: 4, end: 4})).toBe(4);
});
