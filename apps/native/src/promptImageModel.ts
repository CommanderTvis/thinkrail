import type {ToolImage} from './toolResultContent';

export type PromptImage = {id: string; name: string; content: ToolImage; width: number; height: number};
export type PromptImageError = {id: string; name: string; reason: string};
export type PickedImages = {images: PromptImage[]; errors: PromptImageError[]};
export type PromptImageDraft = PickedImages & {pending: number};
export type ImageTransferSource = {uri: string; name: string};
type TransferFile = {uri?: string | null; name?: string | null; type?: string | null};
const messageBudget = 24 * 1024 * 1024;

export function imageTransferSources(files: readonly TransferFile[]): ImageTransferSource[] {
  return files.flatMap(file => {
    if (!file.type?.startsWith('image/') || !file.uri || !(file.uri.startsWith('/') || /^file:\/\/(?:localhost)?\//.test(file.uri) || /^data:image\/[^;,]+;base64,/.test(file.uri))) return [];
    return [{uri: file.uri, name: file.name || 'image'}];
  });
}

export function settlePromptImages(current: PromptImageDraft, result: PickedImages): PromptImageDraft {
  const fitted = fitPromptImages(current.images, result.images);
  return {images: fitted.images, errors: [...current.errors, ...result.errors, ...fitted.errors], pending: Math.max(0, current.pending - 1)};
}

export function fitPromptImages(existing: PromptImage[], additions: PromptImage[]): PickedImages {
  let used = existing.reduce((sum, image) => sum + image.content.data.length, 0);
  const images = [...existing];
  const errors: PromptImageError[] = [];
  for (const image of additions) {
    if (used + image.content.data.length > messageBudget) errors.push({id: image.id, name: image.name, reason: 'message image limit reached'});
    else {used += image.content.data.length; images.push(image);}
  }
  return {images, errors};
}

export function promptContent(text: string, images: ToolImage[]): unknown[] {
  return [...(text ? [{type: 'text', text}] : []), ...images];
}
