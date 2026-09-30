import { expect, test } from "bun:test";
import {
  applyTemplateSlotEdit,
  beginTemplateSlotSession,
  finalizeTemplateSlotSession,
  highlightSegments,
  mirrorAllGroups,
  mirrorSlotGroup,
  parseTemplateSlots,
  shiftSlots,
  stepTemplateSlotSession,
  stripUntouchedSlots
} from "./templateSlots";
test("the shared slot session begins, tracks an edit, advances, and finalizes", () => {
  const begun = beginTemplateSlotSession(parseTemplateSlots("Review $1 with ${2:-src/}", "[file] [scope]")), session = begun.session;
  expect(session).not.toBeNull();
  if (!session)
    return;
  const replacement = "README.md", nextValue = begun.value.slice(0, begun.selection.start) + replacement + begun.value.slice(begun.selection.end), edited = applyTemplateSlotEdit(begun.value, nextValue, begun.selection.start + replacement.length, session);
  expect(edited?.slots[0]).toMatchObject({ filled: !0, edited: !0 });
  if (!edited)
    return;
  const stepped = stepTemplateSlotSession(nextValue, edited, 1);
  expect(stepped.value.slice(stepped.selection.start, stepped.selection.end)).toBe("src/");
  expect(finalizeTemplateSlotSession(stepped.value, stepped.session)).toBe("Review README.md with src/");
});
test("the shared slot session removes an untouched marker on finalization", () => {
  const begun = beginTemplateSlotSession(parseTemplateSlots("Review $1 now"));
  expect(finalizeTemplateSlotSession(begun.value, begun.session)).toBe("Review now");
});
test("a template without placeholders does not start a slot session", () => {
  const begun = beginTemplateSlotSession(parseTemplateSlots("Plain prompt"));
  expect(begun).toEqual({
    value: "Plain prompt",
    session: null,
    selection: { start: 12, end: 12 }
  });
});
test("$1 repeated shares one group; no argumentHint falls back to argN", () => {
  const { text, slots } = parseTemplateSlots("fix $1 then fix $1 again");
  expect(text).toBe("fix \u27E8arg1\u27E9 then fix \u27E8arg1\u27E9 again");
  expect(slots).toHaveLength(2);
  expect(slots[0]).toEqual({ start: 4, end: 10, group: 0, filled: !1 });
  expect(slots[1]).toEqual({ start: 20, end: 26, group: 0, filled: !1 });
  expect(slots[0]?.group).toBe(slots[1]?.group);
});
test("${2:-src/} pre-fills the default text and is marked filled", () => {
  const { text, slots } = parseTemplateSlots("copy to ${2:-src/}");
  expect(text).toBe("copy to src/");
  expect(slots).toEqual([{ start: 8, end: 12, group: 0, filled: !0 }]);
});
test("${N:-default} with an empty default is a zero-length filled slot", () => {
  const { text, slots } = parseTemplateSlots("note: ${1:-}");
  expect(text).toBe("note: ");
  expect(slots).toEqual([{ start: 6, end: 6, group: 0, filled: !0 }]);
});
test("$ARGUMENTS becomes one \u27E8arguments\u27E9 marker slot", () => {
  const { text, slots } = parseTemplateSlots("run: $ARGUMENTS");
  expect(text).toBe("run: \u27E8arguments\u27E9");
  expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: !1 }]);
});
test("$@ becomes one \u27E8arguments\u27E9 marker slot, sharing $ARGUMENTS's group (they're aliases)", () => {
  const { text, slots } = parseTemplateSlots("run: $@");
  expect(text).toBe("run: \u27E8arguments\u27E9");
  expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: !1 }]);
});
test("${@:2} becomes one \u27E8arguments\u27E9 marker slot, grouped apart from $1 and from plain arguments", () => {
  const { text, slots } = parseTemplateSlots("send $1 and ${@:2}");
  expect(text).toBe("send \u27E8arg1\u27E9 and \u27E8arguments\u27E9");
  expect(slots).toHaveLength(2);
  expect(slots[0]).toEqual({ start: 5, end: 11, group: 0, filled: !1 });
  expect(slots[1]).toEqual({ start: 16, end: 27, group: 1, filled: !1 });
  expect(slots[0]?.group).not.toBe(slots[1]?.group);
});
test("${@:2:3} still parses to one marker slot \u2014 a length limit changes its value-class, not the slot count", () => {
  const { text, slots } = parseTemplateSlots("send ${@:2:3}");
  expect(text).toBe("send \u27E8arguments\u27E9");
  expect(slots).toEqual([{ start: 5, end: 16, group: 0, filled: !1 }]);
});
test("a $ that never starts a recognized placeholder is a literal character, unconditionally", () => {
  const { text, slots } = parseTemplateSlots("just $$ dollars");
  expect(text).toBe("just $$ dollars");
  expect(slots).toEqual([]);
});
test("$$1 is a literal $ immediately followed by a live $1 slot \u2014 pi has no escape form for $", () => {
  const { text, slots } = parseTemplateSlots("cost is $$1 dollars");
  expect(text).toBe("cost is $\u27E8arg1\u27E9 dollars");
  expect(slots).toEqual([{ start: 9, end: 15, group: 0, filled: !1 }]);
  expect(text.slice(slots[0]?.start, slots[0]?.end)).toBe("\u27E8arg1\u27E9");
});
test("$0 and $ARGUMENTS get DISTINCT groups \u2014 $0 is its own positional slot, never an all-args alias", () => {
  const { slots } = parseTemplateSlots("arg0=$0 all=$ARGUMENTS");
  expect(slots).toHaveLength(2);
  expect(slots[0]?.group).not.toBe(slots[1]?.group);
});
test("$@, $ARGUMENTS, and ${@:1} share one group \u2014 pi clamps N <= 1 to the same 'from the start' value", () => {
  const { slots } = parseTemplateSlots("a=$@ b=$ARGUMENTS c=${@:1}");
  expect(slots).toHaveLength(3);
  expect(new Set(slots.map((s) => s.group)).size).toBe(1);
});
test("${@:2} repeated shares one group, same as any repeated placeholder", () => {
  const { slots } = parseTemplateSlots("x=${@:2} y=${@:2}");
  expect(slots).toHaveLength(2);
  expect(slots[0]?.group).toBe(slots[1]?.group);
});
test("${@:2} and ${@:3} get DISTINCT groups \u2014 a different start position is a different value", () => {
  const { slots } = parseTemplateSlots("x=${@:2} y=${@:3}");
  expect(slots).toHaveLength(2);
  expect(slots[0]?.group).not.toBe(slots[1]?.group);
});
test("${@:2} and ${@:2:3} get DISTINCT groups too \u2014 a length limit always makes its own class", () => {
  const { slots } = parseTemplateSlots("x=${@:2} y=${@:2:3}");
  expect(slots).toHaveLength(2);
  expect(slots[0]?.group).not.toBe(slots[1]?.group);
});
test("docs example: 'Create a React component named $1 with features: $@'", () => {
  const { text, slots } = parseTemplateSlots("Create a React component named $1 with features: $@");
  expect(text).toBe("Create a React component named \u27E8arg1\u27E9 with features: \u27E8arguments\u27E9");
  expect(slots).toEqual([
    { start: 31, end: 37, group: 0, filled: !1 },
    { start: 53, end: 64, group: 1, filled: !1 }
  ]);
});
test("docs example: 'Summarize the current state in ${1:-7} bullet points.'", () => {
  const { text, slots } = parseTemplateSlots("Summarize the current state in ${1:-7} bullet points.");
  expect(text).toBe("Summarize the current state in 7 bullet points.");
  expect(slots).toEqual([{ start: 31, end: 32, group: 0, filled: !0 }]);
});
test("marker text uses the Nth argumentHint word, stripped of []-brackets", () => {
  const { text, slots } = parseTemplateSlots("$1 at $2 severity", "[file] [severity]");
  expect(text).toBe("\u27E8file\u27E9 at \u27E8severity\u27E9 severity");
  expect(slots).toHaveLength(2);
});
test("a $N beyond the hint's word count falls back to argN", () => {
  const { text } = parseTemplateSlots("$1 $2", "[file]");
  expect(text).toBe("\u27E8file\u27E9 \u27E8arg2\u27E9");
});
test("a blank/whitespace-only argumentHint behaves like no hint at all", () => {
  const { text } = parseTemplateSlots("$1", "   ");
  expect(text).toBe("\u27E8arg1\u27E9");
});
test("a hint word that strips down to nothing (a bare bracket pair) falls back to argN too", () => {
  const { text } = parseTemplateSlots("$1", "[]");
  expect(text).toBe("\u27E8arg1\u27E9");
});
test("stripUntouchedSlots removes an unfilled marker and collapses the doubled whitespace it leaves", () => {
  const { text, slots } = parseTemplateSlots("a $1 b");
  expect(text).toBe("a \u27E8arg1\u27E9 b");
  expect(stripUntouchedSlots(text, slots)).toBe("a b");
});
test("stripUntouchedSlots leaves a filled default slot untouched", () => {
  const { text, slots } = parseTemplateSlots("a ${1:-x} b");
  expect(stripUntouchedSlots(text, slots)).toBe("a x b");
});
test("stripUntouchedSlots strips only the unfilled slot among a mix of filled + unfilled", () => {
  const { text, slots } = parseTemplateSlots("${1:-keep} then $2");
  expect(stripUntouchedSlots(text, slots)).toBe("keep then ");
});
test("stripUntouchedSlots preserves a blank line left by a slot alone on its own line", () => {
  const { text, slots } = parseTemplateSlots(`line one
$1
line two`);
  expect(text).toBe(`line one
\u27E8arg1\u27E9
line two`);
  expect(stripUntouchedSlots(text, slots)).toBe(`line one

line two`);
});
test("stripUntouchedSlots collapses only runs of spaces/tabs, not a lone space next to a newline", () => {
  const { text, slots } = parseTemplateSlots(`a $1
b`);
  expect(text).toBe(`a \u27E8arg1\u27E9
b`);
  expect(stripUntouchedSlots(text, slots)).toBe(`a 
b`);
});
const slot = (start, end) => ({
  start,
  end,
  group: 1,
  filled: !1
});
test("shiftSlots: an edit before a slot shifts it, leaving its length unchanged", () => {
  const [shifted] = shiftSlots([slot(5, 8)], 0, 0, 3);
  expect(shifted).toEqual({ start: 8, end: 11, group: 1, filled: !1 });
});
test("shiftSlots: an edit inside a slot grows it by the inserted length", () => {
  const [shifted] = shiftSlots([slot(5, 8)], 6, 0, 4);
  expect(shifted).toEqual({ start: 5, end: 12, group: 1, filled: !1 });
});
test("shiftSlots: an edit after a slot leaves it untouched", () => {
  const [shifted] = shiftSlots([slot(5, 8)], 10, 0, 5);
  expect(shifted).toEqual({ start: 5, end: 8, group: 1, filled: !1 });
});
test("shiftSlots: typing over a fully-selected marker resizes the slot to the typed text", () => {
  const [shifted] = shiftSlots([slot(5, 11)], 5, 6, 9);
  expect(shifted).toEqual({ start: 5, end: 14, group: 1, filled: !1 });
});
test("shiftSlots: a deletion before a slot shifts it left", () => {
  const [shifted] = shiftSlots([slot(5, 8)], 0, 2, 0);
  expect(shifted).toEqual({ start: 3, end: 6, group: 1, filled: !1 });
});
test("shiftSlots does not mutate its input", () => {
  const original = slot(5, 8), slots = [original];
  shiftSlots(slots, 0, 0, 1);
  expect(slots[0]).toEqual(original);
});
test("shiftSlots re-tracks every slot in the array independently", () => {
  const shifted = shiftSlots([slot(5, 8), slot(20, 24)], 0, 0, 2);
  expect(shifted[0]).toEqual({ start: 7, end: 10, group: 1, filled: !1 });
  expect(shifted[1]).toEqual({ start: 22, end: 26, group: 1, filled: !1 });
});
test("shiftSlots keeps filled/group as-is \u2014 it is purely geometric, not a fill-tracking decision", () => {
  const filledSlot = { start: 5, end: 8, group: 3, filled: !0 }, [shifted] = shiftSlots([filledSlot], 6, 0, 2);
  expect(shifted).toEqual({ start: 5, end: 10, group: 3, filled: !0 });
});
test("shiftSlots: a zero-width insert at a zero-gap boundary pushes the following slot's start forward, never letting it absorb the inserted text", () => {
  const first = slot(0, 6), second = slot(6, 12), [shiftedFirst, shiftedSecond] = shiftSlots([first, second], 6, 0, 3);
  expect(shiftedFirst).toEqual({ start: 0, end: 6, group: 1, filled: !1 });
  expect(shiftedSecond).toEqual({ start: 9, end: 15, group: 1, filled: !1 });
  expect(shiftedSecond?.start).toBeGreaterThanOrEqual(shiftedFirst?.end ?? 0);
});
test("shiftSlots composes with the composer's own active-slot growth to stay non-overlapping across several keystrokes", () => {
  const grow = (slots, editStart, insertedLen) => shiftSlots(slots, editStart, 0, insertedLen).map((s, i) => i === 0 ? { ...s, end: s.end + insertedLen } : s);
  let slots = [slot(0, 6), slot(6, 12)];
  slots = grow(slots, 6, 1);
  expect(slots).toEqual([
    { start: 0, end: 7, group: 1, filled: !1 },
    { start: 7, end: 13, group: 1, filled: !1 }
  ]);
  expect(slots[1]?.start).toBeGreaterThanOrEqual(slots[0]?.end ?? 0);
  slots = grow(slots, 7, 1);
  slots = grow(slots, 8, 1);
  expect(slots).toEqual([
    { start: 0, end: 9, group: 1, filled: !1 },
    { start: 9, end: 15, group: 1, filled: !1 }
  ]);
  expect(slots[1]?.start).toBeGreaterThanOrEqual(slots[0]?.end ?? 0);
});
const gslot = (start, end, group, filled, edited = !1) => ({ start, end, group, filled, ...edited ? { edited: !0 } : {} });
test("mirrorSlotGroup propagates the source's text into a differing same-group sibling, marking it filled", () => {
  const value = "a=X b=Y", slots = [gslot(2, 3, 0, !0), gslot(6, 7, 0, !1)], { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
  expect(next).toBe("a=X b=X");
  expect(nextSlots[0]).toEqual({ start: 2, end: 3, group: 0, filled: !0 });
  expect(nextSlots[1]).toEqual({ start: 6, end: 7, group: 0, filled: !0 });
});
test("mirrorSlotGroup never touches a sibling in a different group", () => {
  const value = "a=X b=Y", slots = [gslot(2, 3, 0, !0), gslot(6, 7, 1, !1)], { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
  expect(next).toBe(value);
  expect(nextSlots[1]).toEqual(slots[1]);
});
test("mirrorSlotGroup is a no-op once every member of a group already agrees \u2014 returns the same references", () => {
  const value = "a=X b=X", slots = [gslot(2, 3, 0, !0), gslot(6, 7, 0, !0)], { value: next, slots: nextSlots } = mirrorSlotGroup(value, slots, 0);
  expect(next).toBe(value);
  expect(nextSlots).toBe(slots);
});
test("mirrorSlotGroup propagates a MULTI-WORD value into every same-group sibling, re-tracking offsets", () => {
  const { text, slots } = parseTemplateSlots("update $1, then test $1, then ship $1");
  expect(slots).toHaveLength(3);
  expect(new Set(slots.map((s) => s.group)).size).toBe(1);
  const filled = "the auth module", s0 = slots[0];
  if (!s0)
    throw Error("expected a first slot");
  const value = text.slice(0, s0.start) + filled + text.slice(s0.end), filledSlots = shiftSlots(slots, s0.start, s0.end - s0.start, filled.length).map((s, i) => i === 0 ? { ...s, filled: !0 } : s), { value: next, slots: out } = mirrorSlotGroup(value, filledSlots, 0);
  expect(next).toBe("update the auth module, then test the auth module, then ship the auth module");
  for (const s of out)
    expect(next.slice(s.start, s.end)).toBe(filled);
});
test("mirrorAllGroups propagates every user-edited slot's text into its own group's siblings, and never touches a different group", () => {
  const value = "W.m.M", slots = [gslot(0, 1, 0, !0, !0), gslot(2, 3, 1, !1), gslot(4, 5, 0, !1)], { value: next, slots: nextSlots } = mirrorAllGroups(value, slots);
  expect(next).toBe("W.m.W");
  expect(nextSlots[0]).toEqual({ start: 0, end: 1, group: 0, filled: !0, edited: !0 });
  expect(nextSlots[1]).toEqual({ start: 2, end: 3, group: 1, filled: !1 });
  expect(nextSlots[2]).toEqual({ start: 4, end: 5, group: 0, filled: !0 });
});
test("mirrorAllGroups: when two siblings are independently EDITED with different text, the earliest in array order wins", () => {
  const value = "a=X b=Y", slots = [gslot(2, 3, 0, !0, !0), gslot(6, 7, 0, !0, !0)], { value: next, slots: nextSlots } = mirrorAllGroups(value, slots);
  expect(next).toBe("a=X b=X");
  expect(nextSlots.every((s) => s.filled)).toBe(!0);
});
test("parseTemplateSlots marks a ${N:-default} filled but NOT edited", () => {
  const { slots } = parseTemplateSlots("copy to ${2:-src/}");
  expect(slots).toHaveLength(1);
  expect(slots[0]?.filled).toBe(!0);
  expect(slots[0]?.edited).toBeUndefined();
});
test("mirrorAllGroups leaves two differing UNTOUCHED defaults independent \u2014 no edit means no mirror", () => {
  const { text, slots } = parseTemplateSlots("${1:-foo} versus ${1:-bar}");
  expect(text).toBe("foo versus bar");
  expect(slots).toHaveLength(2);
  expect(slots[0]?.group).toBe(slots[1]?.group);
  expect(slots.every((s) => s.filled && !s.edited)).toBe(!0);
  const { value: next, slots: nextSlots } = mirrorAllGroups(text, slots);
  expect(next).toBe("foo versus bar");
  expect(nextSlots).toBe(slots);
});
test("mirrorAllGroups mirrors from an EDITED default into its group-mate (the user provided the argument)", () => {
  const { slots } = parseTemplateSlots("${1:-foo} versus ${1:-bar}"), s0 = slots[0];
  if (!s0)
    throw Error("expected a first slot");
  const typed = "cats", value = `${typed} versus bar`, editedSlots = shiftSlots(slots, s0.start, s0.end - s0.start, typed.length).map((s, i) => i === 0 ? { ...s, filled: !0, edited: !0 } : s), { value: next } = mirrorAllGroups(value, editedSlots);
  expect(next).toBe("cats versus cats");
});
const segText = (segs) => segs.map((s) => s.text).join("");
test("highlightSegments: no slots produces one plain segment spanning the whole value", () => {
  const value = "hello world", segs = highlightSegments(value, [], 0);
  expect(segs).toEqual([{ text: "hello world", state: "plain" }]);
  expect(segText(segs)).toBe(value);
});
test("highlightSegments: no slots on an empty value still round-trips (one empty plain segment)", () => {
  const segs = highlightSegments("", [], 0);
  expect(segs).toEqual([{ text: "", state: "plain" }]);
  expect(segText(segs)).toBe("");
});
test("highlightSegments: a single unfilled slot renders plain/unfilled/plain around it", () => {
  const before = "fix ", marker = "\u27E8arg1\u27E9", after = " now", value = before + marker + after, slots = [gslot(before.length, before.length + marker.length, 0, !1)], segs = highlightSegments(value, slots, -1);
  expect(segs).toEqual([
    { text: before, state: "plain" },
    { text: marker, state: "unfilled" },
    { text: after, state: "plain" }
  ]);
  expect(segText(segs)).toBe(value);
});
test("highlightSegments: a filled slot renders as 'filled'", () => {
  const before = "copy to ", filled = "src/", value = before + filled, slots = [gslot(before.length, before.length + filled.length, 0, !0)], segs = highlightSegments(value, slots, -1);
  expect(segs).toEqual([
    { text: before, state: "plain" },
    { text: filled, state: "filled" }
  ]);
  expect(segText(segs)).toBe(value);
});
test("highlightSegments: activeIdx marks exactly the slot at that array index 'active', regardless of filled", () => {
  const value = "ab", slots = [gslot(0, 1, 0, !1), gslot(1, 2, 1, !0)], segs = highlightSegments(value, slots, 1);
  expect(segs).toEqual([
    { text: "a", state: "unfilled" },
    { text: "b", state: "active" }
  ]);
  expect(segs.filter((s) => s.state === "active")).toHaveLength(1);
  expect(segText(segs)).toBe(value);
});
test("highlightSegments: zero-gap adjacent slots (the $1$2 shape) produce no empty plain segment between them", () => {
  const first = "\u27E8arg1\u27E9", second = "\u27E8arg2\u27E9", value = first + second, slots = [
    gslot(0, first.length, 0, !1),
    gslot(first.length, first.length + second.length, 1, !1)
  ], segs = highlightSegments(value, slots, 0);
  expect(segs).toEqual([
    { text: first, state: "active" },
    { text: second, state: "unfilled" }
  ]);
  expect(segs.some((s) => s.state === "plain")).toBe(!1);
  expect(segText(segs)).toBe(value);
});
test("highlightSegments: a multi-word slot's text stays in one segment", () => {
  const before = "Rename ", mid = "the auth module", after = " now", value = before + mid + after, slots = [gslot(before.length, before.length + mid.length, 0, !0)], segs = highlightSegments(value, slots, -1);
  expect(segs).toEqual([
    { text: before, state: "plain" },
    { text: mid, state: "filled" },
    { text: after, state: "plain" }
  ]);
  expect(segs).toHaveLength(3);
  expect(segText(segs)).toBe(value);
});
