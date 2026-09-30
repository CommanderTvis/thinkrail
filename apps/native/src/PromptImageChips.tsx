import {type SetStateAction, useState} from 'react';
import {NativeModules, Pressable, StyleSheet, Text, View} from 'react-native';
import {tid} from './testId';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {imageTransferSources, settlePromptImages, type ImageTransferSource, type PickedImages, type PromptImageDraft} from './promptImageModel';

const picker = NativeModules.PromptImages as {pick: () => Promise<PickedImages>; prepare: (sources: ImageTransferSource[]) => Promise<PickedImages>};
export const emptyPromptImages: PromptImageDraft = {images: [], errors: [], pending: 0};

async function addPromptImages(prepare: () => Promise<PickedImages>, onChange: (value: SetStateAction<PromptImageDraft>) => void) {
  onChange(current => ({...current, pending: current.pending + 1}));
  try {
    const result = await prepare();
    onChange(current => settlePromptImages(current, result));
  } catch (error) {
    onChange(current => settlePromptImages(current, {images: [], errors: [{id: String(Date.now()), name: 'image', reason: String(error)}]}));
  }
}

export function pickPromptImages(onChange: (value: SetStateAction<PromptImageDraft>) => void) {
  return addPromptImages(() => picker.pick(), onChange);
}

export function transferPromptImages(files: Parameters<typeof imageTransferSources>[0], onChange: (value: SetStateAction<PromptImageDraft>) => void) {
  const sources = imageTransferSources(files);
  if (sources.length) return addPromptImages(() => picker.prepare(sources), onChange);
}

export function PromptImageChips({value, onChange, commandError}: {value: PromptImageDraft; onChange: (value: SetStateAction<PromptImageDraft>) => void; commandError?: string}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState('');
  if (!commandError && !value.pending && !value.images.length && !value.errors.length) return null;
  return <View style={s.chips}>
    {commandError ? <View {...{tooltip: commandError}} collapsable={false} accessibilityRole="alert" accessibilityLabel={commandError} style={[s.chip, s.error]}>
      <Text numberOfLines={1} style={[s.label, s.errorText]}>{commandError}</Text>
    </View> : null}
    {value.errors.map(error => <View key={error.id} {...{tooltip: `Couldn't attach ${error.name} — ${error.reason}`}} collapsable={false} style={[s.chip, s.error]}>
      <Text numberOfLines={1} style={[s.label, s.errorText]}>{`Couldn't attach ${error.name}`}</Text>
      <Text style={[s.meta, s.errorText]}>{`— ${error.reason}`}</Text>
      <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Dismiss attachment error"
        onHoverIn={() => setHovered(error.id)} onHoverOut={() => setHovered('')} style={hovered === error.id && s.dismissHovered}
        onPress={() => onChange(current => ({...current, errors: current.errors.filter(item => item.id !== error.id)}))}>
        <Icon name="close" size={12} color={color.red} />
      </Pressable>
    </View>)}
    {value.images.map(image => <View key={image.id} {...tid('composer-image', {width: image.width, height: image.height})} {...{tooltip: image.name}} collapsable={false} style={s.chip}>
      <Icon name="file" size={12} color={color.text} /><Text numberOfLines={1} style={s.label}>{image.name}</Text>
      {image.width && image.height ? <Text style={s.meta}>{` · ${image.width}×${image.height}`}</Text> : null}
      <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel={`Remove image ${image.name}`} onPress={() => onChange(current => ({...current, images: current.images.filter(item => item.id !== image.id)}))}
        onHoverIn={() => setHovered(image.id)} onHoverOut={() => setHovered('')}>
        <Icon name="close" size={12} color={hovered === image.id ? color.text : color.muted} />
      </Pressable>
    </View>)}
    {value.pending ? <View style={s.chip}><Icon name="file" size={12} color={color.text} /><Text style={[s.meta, s.pending]}>{value.pending === 1 ? 'Attaching…' : `Attaching ${value.pending}…`}</Text></View> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12, paddingTop: 12},
  chip: {maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  label: {minWidth: 0, flexShrink: 1, fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.text},
  meta: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.text}, pending: {color: palette.muted},
  error: {borderColor: `${palette.red}66`, backgroundColor: `${palette.red}1f`}, errorText: {color: palette.red}, dismissHovered: {opacity: 0.8},
});
