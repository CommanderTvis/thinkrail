import type {ChatMessage} from './HostClient';

export type ChatMessageOrder = 'oldest-first' | 'newest-first';
export type ChatRow = {id: string; message: ChatMessage; streaming?: boolean; activity?: boolean};

export function projectChatRows(messages: ChatMessage[], streamingMessage: ChatMessage | undefined, order: ChatMessageOrder, streaming = false): ChatRow[] {
  const rows: ChatRow[] = [];
  let activity: unknown[] = [];
  let activityRow: ChatRow | undefined;
  const flush = () => {
    if (activityRow) rows.push({...activityRow, message: {...activityRow.message, content: activity}});
    activity = [];
    activityRow = undefined;
  };
  const append = (message: ChatMessage, id: string) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content) || !message.content.length) {
      flush();
      rows.push({id, message});
      return;
    }
    message.content.forEach((block, index) => {
      if (typeof block !== 'object' || block === null) return;
      const type = Reflect.get(block, 'type');
      if (type === 'text') {
        const text = Reflect.get(block, 'text');
        if (typeof text !== 'string' || !text.trim()) return;
        flush();
        rows.push({id: `${id}:${index}`, message: {...message, content: [block]}});
      } else if (type === 'toolCall' || (type === 'thinking' && typeof Reflect.get(block, 'thinking') === 'string' && Reflect.get(block, 'thinking').trim())) {
        if (!activity.length) activityRow = {id: `${id}:${index}`, message, activity: true};
        activity.push(block);
      }
    });
  };
  const visibleMessages = messages.filter(message => message.role !== 'toolResult');
  visibleMessages.forEach((message, index) => append(message, `message:${index}`));
  if (streamingMessage) {
    append(streamingMessage, `message:${visibleMessages.length}`);
  }
  flush();
  const latest = rows.at(-1);
  if (latest?.message.role === 'assistant' && (streamingMessage || (streaming && latest.activity))) latest.streaming = true;
  return order === 'newest-first' ? rows.reverse() : rows;
}
