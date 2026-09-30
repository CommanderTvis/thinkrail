import type * as ReactNative from 'react-native';

type Fiber = {
  tag: number;
  memoizedProps: Record<string, unknown> | string | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  stateNode: unknown;
};
type FiberRoot = {current: Fiber};
type TextMatch = string | {source: string; flags: string};
type Query = {testId: string} | {text: string; exact: boolean} | {label: string};
type Filter = {hasText?: TextMatch; hasNotText?: TextMatch; attrs?: Record<string, string>; attrsNot?: Record<string, string>};
type Step = {query: Query; filters: Filter[]; index?: number};
type Command = {id: number; op: string; chain: Step[]; args?: Record<string, unknown>};

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;

const roots = new Set<FiberRoot>();

type DevtoolsHook = {
  onCommitFiberRoot?: (id: number, root: FiberRoot, ...rest: unknown[]) => void;
  onCommitFiberUnmount?: (...args: unknown[]) => void;
  inject?: (renderer: unknown) => number;
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
};

function installAutomationHook() {
  const global = globalThis as {__REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook};
  const existing = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing) {
    const previous = existing.onCommitFiberRoot;
    existing.onCommitFiberRoot = (id, root, ...rest) => {
      roots.add(root);
      previous?.call(existing, id, root, ...rest);
    };
    return;
  }
  let nextRenderer = 1;
  global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => nextRenderer++,
    onCommitFiberRoot: (_id, root) => {roots.add(root);},
    onCommitFiberUnmount: () => {},
  };
}

function props(fiber: Fiber): Record<string, unknown> {
  return fiber.memoizedProps && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps : {};
}

function testIdOf(fiber: Fiber): string | undefined {
  const id = props(fiber).testID;
  return typeof id === 'string' ? id : undefined;
}

function parseAttrs(testID: string): Record<string, string> {
  const [, ...pairs] = testID.split('|');
  return Object.fromEntries(pairs.map(pair => {
    const at = pair.indexOf('=');
    return at < 0 ? [pair, 'true'] : [pair.slice(0, at), pair.slice(at + 1)];
  }));
}

function* walk(fiber: Fiber | null): Generator<Fiber> {
  for (let node = fiber; node; node = node.sibling) {
    yield node;
    yield* walk(node.child);
  }
}

function textOf(fiber: Fiber): string {
  const parts: string[] = [];
  const own = props(fiber);
  if (typeof own.accessibilityLabel === 'string') parts.push(own.accessibilityLabel);
  for (const node of walk(fiber.child)) {
    if (node.tag === HOST_TEXT && typeof node.memoizedProps === 'string') parts.push(node.memoizedProps);
    else if (node.tag !== HOST_TEXT && typeof props(node).value === 'string' && props(node).onChangeText) parts.push(props(node).value as string);
  }
  return parts.join('');
}

function matches(text: string, expected: TextMatch): boolean {
  return typeof expected === 'string' ? text.includes(expected) : new RegExp(expected.source, expected.flags).test(text);
}

function queryMatches(fiber: Fiber, query: Query, parent: Fiber | null): boolean {
  if ('testId' in query) {
    if (fiber.tag !== HOST_COMPONENT) return false;
    const id = testIdOf(fiber);
    if (!id || (id !== query.testId && !id.startsWith(`${query.testId}|`))) return false;
    for (let up = fiber.return; up && up !== parent; up = up.return) if (up.tag === HOST_COMPONENT && testIdOf(up) === id) return false;
    return true;
  }
  if ('label' in query) return props(fiber).accessibilityLabel === query.label && fiber.tag !== HOST_TEXT;
  if (fiber.tag !== HOST_TEXT || typeof fiber.memoizedProps !== 'string') return false;
  return query.exact ? fiber.memoizedProps === query.text : fiber.memoizedProps.includes(query.text);
}

function accepts(fiber: Fiber, filters: Filter[]): boolean {
  for (const filter of filters) {
    if (filter.attrs || filter.attrsNot) {
      const attrs = parseAttrs(testIdOf(fiber) ?? '');
      if (Object.entries(filter.attrs ?? {}).some(([name, value]) => attrs[name] !== value)) return false;
      if (Object.entries(filter.attrsNot ?? {}).some(([name, value]) => attrs[name] === value)) return false;
    }
    if (filter.hasText !== undefined && !matches(textOf(fiber), filter.hasText)) return false;
    if (filter.hasNotText !== undefined && matches(textOf(fiber), filter.hasNotText)) return false;
  }
  return true;
}

function resolve(chain: Step[]): Fiber[] {
  let scopes: Array<Fiber | null> = [...roots].map(root => root.current.child ? root.current : null).filter(Boolean);
  for (const step of chain) {
    const found: Fiber[] = [];
    for (const scope of scopes) {
      if (!scope) continue;
      for (const fiber of walk(scope.child)) {
        if (queryMatches(fiber, step.query, scope) && accepts(fiber, step.filters) && !found.includes(fiber)) found.push(fiber);
      }
    }
    if (step.index === undefined) scopes = found;
    else {
      const picked = step.index < 0 ? found.at(step.index) : found[step.index];
      scopes = picked ? [picked] : [];
    }
  }
  return scopes.filter((fiber): fiber is Fiber => fiber !== null);
}

function one(chain: Step[]): Fiber {
  const found = resolve(chain);
  if (found.length !== 1) throw new Error(`selector resolved to ${found.length} elements, expected exactly one`);
  return found[0];
}

function handler(fiber: Fiber, name: string): ((...args: unknown[]) => unknown) | undefined {
  for (let node: Fiber | null = fiber; node; node = node.return) {
    const candidate = props(node)[name];
    if (typeof candidate === 'function') return candidate as (...args: unknown[]) => unknown;
  }
  for (const node of walk(fiber.child)) {
    const candidate = props(node)[name];
    if (typeof candidate === 'function') return candidate as (...args: unknown[]) => unknown;
  }
  return undefined;
}

function syntheticEvent(nativeEvent: Record<string, unknown> = {}) {
  let stopped = false;
  let prevented = false;
  return {
    nativeEvent, persist() {},
    stopPropagation() {stopped = true;}, isPropagationStopped: () => stopped,
    preventDefault() {prevented = true;}, isDefaultPrevented: () => prevented,
  };
}

function hostInstance(fiber: Fiber): {measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void} | undefined {
  for (const node of [fiber, ...walk(fiber.child)]) {
    const instance = node.stateNode as {canonical?: {publicInstance?: unknown}; measureInWindow?: unknown} | null;
    const pub = (instance?.canonical?.publicInstance ?? instance) as {measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void} | null;
    if (pub?.measureInWindow) return pub;
  }
  return undefined;
}

function call(fiber: Fiber, name: string, ...args: unknown[]) {
  const fn = handler(fiber, name);
  if (!fn) throw new Error(`element has no ${name} handler`);
  return fn(...args);
}

const KEY_NAMES: Record<string, string> = {Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight'};

type Modifiers = {metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean};

function acceptsKey(fiber: Fiber, key: string, modifiers: Modifiers): boolean {
  const events = props(fiber).keyDownEvents;
  if (!Array.isArray(events)) return true;
  return events.some(entry => {
    const event = entry as Partial<Modifiers> & {key?: string};
    return event.key === key && (Object.keys(modifiers) as (keyof Modifiers)[]).every(name => Boolean(event[name]) === modifiers[name]);
  });
}

async function pressKey(fiber: Fiber, combo: string) {
  const parts = combo.split('+');
  const key = KEY_NAMES[parts.pop() ?? ''] ?? combo.split('+').pop() ?? '';
  const modifiers = {metaKey: parts.includes('Meta'), ctrlKey: parts.includes('Control'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift')};
  const input = textInputOf(fiber);
  const event = syntheticEvent({key, ...modifiers});
  const stoppedNow = () => event.isPropagationStopped();
  const onKeyPress = input && props(input).onKeyPress;
  if (typeof onKeyPress === 'function') onKeyPress(event);
  const start = input ? [input, ...walk(input.child)].find(node => node.tag === HOST_COMPONENT) ?? input : fiber;
  for (let node: Fiber | null = start; node && !stoppedNow(); node = node.return) {
    if (input && key === 'Enter' && node !== start) break;
    if (node.tag !== HOST_COMPONENT) continue;
    const onKeyDown = props(node).onKeyDown;
    if (typeof onKeyDown === 'function' && acceptsKey(node, key, modifiers)) onKeyDown(event);
  }
  if (event.isDefaultPrevented() || stoppedNow() || !input || key !== 'Enter') return;
  const submitsOn = props(input).submitKeyEvents;
  const submits = props(input).multiline !== true || (Array.isArray(submitsOn) && submitsOn.some(entry => {
    const submitKey = entry as Partial<Modifiers> & {key?: string};
    return submitKey.key === 'Enter' && Boolean(submitKey.shiftKey) === modifiers.shiftKey;
  }));
  if (submits && !modifiers.shiftKey) {
    const submit = props(input).onSubmitEditing;
    if (typeof submit === 'function') submit(syntheticEvent({text: props(input).value}));
  } else if (props(input).multiline === true) await insertNativeText(input, '\n', false);
}


function textInputOf(fiber: Fiber): Fiber | undefined {
  const hasHandler = (node: Fiber) => typeof props(node).onChangeText === 'function';
  const below = [fiber, ...walk(fiber.child)].find(hasHandler);
  if (below) return below;
  for (let node = fiber.return; node; node = node.return) if (hasHandler(node)) return node;
  return undefined;
}

function blurOutside(fiber: Fiber) {
  const {TextInput}: typeof ReactNative = require('react-native');
  const focused = TextInput.State.currentlyFocusedInput();
  if (!focused) return;
  const inside = [fiber, ...walk(fiber.child)].some(node => {
    const instance = node.stateNode as {canonical?: {publicInstance?: unknown}} | null;
    return (instance?.canonical?.publicInstance ?? instance) === focused;
  });
  if (!inside) TextInput.State.blurTextInput(focused);
}

async function insertNativeText(fiber: Fiber, text: string, replaceAll: boolean) {
  const input = textInputOf(fiber);
  const host = input && hostInstance(input) as {focus?: () => void} | undefined;
  if (!input) throw new Error('element has no native text input');
  const {NativeModules}: typeof ReactNative = require('react-native');
  const automation = NativeModules.ThinkRailAutomation;
  const value = typeof props(input).value === 'string' ? props(input).value : undefined;
  let focused = await automation.focusedSelection();
  for (let attempt = 0; attempt < 15 && !focused; attempt++) {
    await new Promise(done => setTimeout(done, 20));
    focused = await automation.focusedSelection();
  }
  if (!focused || (value !== undefined && focused.text !== value)) {
    if (!host?.focus) throw new Error('text input is not focused and cannot be focused');
    host.focus();
  }
  for (let attempt = 0; attempt < 50 && !(await automation.focusedSelection()); attempt++) {
    await new Promise(done => setTimeout(done, 20));
  }
  await automation.insertText(text, replaceAll);
}

async function execute(command: Command): Promise<unknown> {
  const args = command.args ?? {};
  switch (command.op) {
    case 'openedURLs': return openedURLs.slice();
    case 'count': return resolve(command.chain).length;
    case 'texts': return resolve(command.chain).map(textOf);
    case 'testIds': return resolve(command.chain).map(fiber => testIdOf(fiber) ?? '');
    case 'value': {
      const fiber = one(command.chain);
      for (const node of [fiber, ...walk(fiber.child)]) {
        const value = props(node).value ?? props(node).defaultValue;
        if (typeof value === 'string' && (props(node).onChangeText || props(node).editable !== undefined)) return value;
      }
      return '';
    }
    case 'press': {
      const target = one(command.chain);
      blurOutside(target);
      call(target, 'onPress', syntheticEvent(args));
      return undefined;
    }
    case 'longPress': call(one(command.chain), 'onLongPress', syntheticEvent(args)); return undefined;
    case 'hover': call(one(command.chain), 'onHoverIn', syntheticEvent()); return undefined;
    case 'unhover': call(one(command.chain), 'onHoverOut', syntheticEvent()); return undefined;
    case 'fill': await insertNativeText(one(command.chain), String(args.text), true); return undefined;
    case 'key': await pressKey(one(command.chain), String(args.key)); return undefined;
    case 'paste': call(one(command.chain), 'onPaste', syntheticEvent({dataTransfer: {files: args.files, items: [], types: ['image']}})); return undefined;
    case 'focusedSelection': {
      const {NativeModules}: typeof ReactNative = require('react-native');
      return await NativeModules.ThinkRailAutomation.focusedSelection();
    }
    case 'type': await insertNativeText(one(command.chain), String(args.text), false); return undefined;
    case 'box': {
      const instance = hostInstance(one(command.chain));
      if (!instance?.measureInWindow) throw new Error('element has no host view');
      return await new Promise(done => instance.measureInWindow?.((x, y, width, height) => done({x, y, width, height})));
    }
    default: throw new Error(`unknown automation op ${command.op}`);
  }
}

let started = false;
const openedURLs: string[] = [];

function interceptLinks() {
  const {Linking}: typeof ReactNative = require('react-native');
  Linking.openURL = async (url: string) => {openedURLs.push(url);};
}

export function startAutomation(url: string) {
  if (started) return;
  started = true;
  interceptLinks();
  const socket = new WebSocket(url);
  socket.onmessage = event => {
    const command = JSON.parse(String(event.data)) as Command;
    execute(command).then(
      result => socket.send(JSON.stringify({id: command.id, ok: true, result})),
      error => socket.send(JSON.stringify({id: command.id, ok: false, error: String(error?.message ?? error)})),
    );
  };
  socket.onopen = () => socket.send(JSON.stringify({hello: true}));
}

installAutomationHook();
