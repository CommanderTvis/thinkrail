export type ToolImage = {type: 'image'; data: string; mimeType: string};

const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function parseToolResultContent(result: unknown): {text: string; images: ToolImage[]} {
  if (result == null) return {text: '', images: []};
  if (typeof result === 'string') return {text: result, images: []};
  if (typeof result === 'object' && 'content' in result && Array.isArray(result.content)) {
    const text: string[] = [];
    const images: ToolImage[] = [];
    for (const value of result.content) {
      if (typeof value !== 'object' || value === null) continue;
      const block = value as {type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown};
      if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
      else if (block.type === 'image' && typeof block.data === 'string' && block.data.length > 0 &&
        typeof block.mimeType === 'string' && acceptedImageTypes.has(block.mimeType)) {
        images.push({type: 'image', data: block.data, mimeType: block.mimeType});
      }
    }
    return {text: text.join(''), images};
  }
  try {return {text: JSON.stringify(result, null, 2) ?? '', images: []};}
  catch {return {text: String(result), images: []};}
}

export function toolImageSize(size: {width: number; height: number}, availableWidth: number): {width: number; height: number} {
  const scale = Math.min(1, availableWidth / size.width, 240 / size.height);
  return {width: size.width * scale, height: size.height * scale};
}

export function attachmentImageSize(size: {width: number; height: number}, window: {width: number; height: number}): {width: number; height: number} {
  const availableWidth = Math.max(0, window.width * 0.95 - 32);
  const availableHeight = Math.max(0, Math.min(window.height * 0.8, window.height * 0.9 - 57.5));
  const scale = Math.min(1, availableWidth / size.width, availableHeight / size.height);
  return {width: size.width * scale, height: size.height * scale};
}
