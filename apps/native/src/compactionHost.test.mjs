import {expect, test} from 'bun:test';
const built = await Bun.build({entrypoints: [new URL('./HostClient.ts', import.meta.url).pathname], target: 'bun', format: 'esm', plugins: [{name: 'native-theme-fixture', setup(build) {
  build.onResolve({filter: /^\.\/Theme$/}, () => ({path: 'Theme', namespace: 'fixture'}));
  build.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export function setThemePreference() {}', loader: 'js'}));
}}]});
if (!built.success) throw new Error(built.logs.map(String).join('\n'));
const {hostClient} = await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0].text()).toString('base64')}`);
function client() {
  const instance = new hostClient.constructor();
  instance.set({workspaceId: 'w', sessionId: 's', connection: 'connected', streaming: false});
  return instance;
}
const emit = (instance, event) => instance.onPiEvent({sessionId: 's', event});
const end = overrides => ({type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, result: {tokensBefore: 2000, estimatedTokensAfter: 300}, ...overrides});

test('host controller drains text before compacting and reconciles the canonical summary', async () => {
  const instance = client(), calls = [], restored = [];
  instance.request = async (method, params) => {
    calls.push({method, params});
    if (method === 'session.clearQueue') return {steering: [{text: 'Steer'}], followUp: [{text: 'Follow up'}]};
    if (method === 'session.compact') {
      expect(restored).toEqual(['Steer\n\nFollow up']);
      emit(instance, {type: 'compaction_start', reason: 'manual'}); emit(instance, end());
      return {ok: true};
    }
    if (method === 'session.getMessages') return {summary: {isStreaming: false}, messages: [{role: 'compactionSummary', tokensBefore: 2000, summary: 'Canonical Pi summary'}]};
    throw Error(method);
  };
  await instance.compactSession('w', 's', 'Retain open tasks', text => restored.push(text));
  await instance.compactionSync;
  expect(calls.map(call => call.method)).toEqual(['session.clearQueue', 'session.compact', 'session.getMessages']);
  expect(calls[0].params).toEqual({sessionId: 's', requireTextOnly: true});
  expect(calls[1].params).toEqual({sessionId: 's', instructions: 'Retain open tasks'});
  expect(instance.getSnapshot().messages[0].compaction).toMatchObject({summary: 'Canonical Pi summary', tokensAfter: 300});
});

test('Pi lifecycle rejection yields one failure and a rejected queue drain never invokes compact', async () => {
  const instance = client();
  instance.request = async method => {
    if (method === 'session.clearQueue') return {steering: [], followUp: []};
    emit(instance, {type: 'compaction_start', reason: 'manual'}); emit(instance, end({errorMessage: 'Pi failure'}));
    throw Error('Pi failure');
  };
  await instance.compactSession('w', 's', '', () => {});
  expect(instance.getSnapshot().messages).toHaveLength(1);
  expect(instance.getSnapshot().messages[0].compaction).toEqual({status: 'failed', detail: 'Pi failure'});
  const other = client(), calls = [];
  other.request = async method => {calls.push(method); throw Error('Queued images');};
  await other.compactSession('w', 's', '', () => {throw Error('Unexpected restore');});
  expect(calls).toEqual(['session.clearQueue']);
  expect(other.getSnapshot().messages[0].compaction.status).toBe('failed');
});

test('Pi queue flags are retained and crossed streaming reads cannot replace the transcript', async () => {
  const instance = client();
  emit(instance, {type: 'queue_update', steering: ['Correction'], followUp: ['Question'], hasImages: true});
  expect(instance.getSnapshot().queue).toEqual({steering: ['Correction'], followUp: ['Question'], hasImages: true});
  const read = Promise.withResolvers();
  instance.request = () => read.promise;
  emit(instance, end());
  emit(instance, {type: 'agent_start'});
  emit(instance, {type: 'message_update', assistantMessageEvent: {partial: {role: 'assistant', content: [{type: 'text', text: 'Live response'}]}}});
  read.resolve({summary: {isStreaming: false}, messages: [{role: 'user', content: 'Stale snapshot'}]});
  await instance.compactionSync;
  expect(instance.getSnapshot().messages.some(message => message.content === 'Stale snapshot')).toBe(false);
  expect(instance.getSnapshot().streamingMessage.content[0].text).toBe('Live response');
});

test('settlement during an older read schedules the current idle transcript', async () => {
  const instance = client(), older = Promise.withResolvers();
  let reads = 0;
  instance.request = async method => {
    if (method === 'session.list') return [];
    if (method === 'session.getStats') return {tokens: {total: 300}, cost: 0};
    reads++;
    return reads === 1 ? older.promise : {summary: {isStreaming: false}, messages: [{role: 'compactionSummary', tokensBefore: 2000, summary: 'Current idle summary'}]};
  };
  emit(instance, end()); emit(instance, {type: 'agent_start'}); emit(instance, {type: 'agent_settled'});
  older.resolve({summary: {isStreaming: true}, messages: []});
  while (instance.compactionSync) await instance.compactionSync;
  expect(reads).toBe(2);
  expect(instance.getSnapshot().messages[0].summary).toBe('Current idle summary');
});

test('session hydration cannot overwrite a newer Pi queue image flag', async () => {
  const instance = client(), transcript = Promise.withResolvers();
  instance.request = async method => method === 'session.getMessages' ? transcript.promise : method === 'todo.list' ? {todos: []} : {tokens: {total: 0}, cost: 0};
  const selecting = instance.selectSession('s');
  emit(instance, {type: 'queue_update', steering: [], followUp: ['Image prompt'], hasImages: true});
  transcript.resolve({summary: {queue: {steering: [], followUp: []}}, messages: []});
  await selecting;
  expect(instance.getSnapshot().queue).toEqual({steering: [], followUp: ['Image prompt'], hasImages: true});
});
