import {createContext, type ReactNode, useContext, useEffect, useRef, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, useWindowDimensions, type View as NativeView} from 'react-native';
import {View} from 'react-native-macos';
import {Icon} from './Icon';
import {attachmentImageSize, toolImageSize, type ToolImage} from './toolResultContent';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

type Preview = {image: ToolImage; label: string; attachment?: boolean; returnFocus: () => void};
const PreviewContext = createContext<(preview: Preview) => void>(() => {});

export function useImagePreview() {
  return useContext(PreviewContext);
}

function useImageDimensions(source: string | undefined) {
  const [size, setSize] = useState<{width: number; height: number}>();
  useEffect(() => {
    let active = true;
    setSize(undefined);
    if (source) Image.getSize(source, (width, height) => {if (active) setSize({width, height});}, () => {});
    return () => {active = false;};
  }, [source]);
  return size;
}

function ImageDialog({preview, onClose}: {preview: Preview; onClose: () => void}) {
  const s = useThemeStyles(makeStyles);
  const dialog = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  const window = useWindowDimensions();
  const source = `data:${preview.image.mimeType};base64,${preview.image.data}`;
  const naturalSize = useImageDimensions(preview.attachment ? source : undefined);
  const attachmentSize = naturalSize ? attachmentImageSize(naturalSize, window) : {width: 0, height: 0};
  useEffect(() => {dialog.current?.focus();}, []);
  const closeButton = <Pressable accessibilityRole="button" accessibilityLabel="Close image preview" onPress={onClose}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.close, hovered && s.hovered, preview.attachment && s.attachmentClose]}>
    <Icon name="close" color={hovered ? color.text : color.muted} size={16} />
  </Pressable>;
  return <View ref={dialog} focusable accessibilityViewIsModal style={s.overlay} keyDownEvents={[{key: 'Escape'}]}
    onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}}}>
    <Pressable accessibilityLabel="Dismiss image preview" style={s.backdrop} onPress={onClose} />
    <View style={[s.dialog, preview.attachment && s.attachmentDialog]}><View style={s.dialogHeader}>
      <Text numberOfLines={1} style={[s.title, preview.attachment && s.attachmentTitle]}>{preview.label}</Text>
      {!preview.attachment ? closeButton : null}
    </View>{preview.attachment ? closeButton : null}<View style={[s.fullImageFrame, preview.attachment && s.attachmentFrame]}><Image accessibilityLabel={preview.label} resizeMode="contain"
      source={{uri: source}} style={preview.attachment ? [s.attachmentImage, attachmentSize] : s.fullImage} /></View></View>
  </View>;
}

export function ImagePreviewProvider({children}: {children: ReactNode}) {
  const s = useThemeStyles(makeStyles);
  const [preview, setPreview] = useState<Preview | null>(null);
  const close = () => {
    setPreview(null);
    requestAnimationFrame(() => preview?.returnFocus());
  };
  return <PreviewContext.Provider value={setPreview}><View style={s.root}>{children}
    {preview ? <ImageDialog preview={preview} onClose={close} /> : null}
  </View></PreviewContext.Provider>;
}

function ToolResultImage({image, label}: {image: ToolImage; label: string}) {
  const s = useThemeStyles(makeStyles);
  const open = useImagePreview();
  const opener = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(320);
  const source = `data:${image.mimeType};base64,${image.data}`;
  const naturalSize = useImageDimensions(source);
  const size = naturalSize ? toolImageSize(naturalSize, availableWidth) : {width: availableWidth, height: 64};
  return <View style={s.frame} onLayout={event => setAvailableWidth(Math.max(0, event.nativeEvent.layout.width - 2))}>
    <Image source={{uri: source}} accessibilityLabel={label} resizeMode="contain" style={size} />
    <Pressable ref={opener} accessibilityRole="button" accessibilityLabel={`View ${label} full screen`}
      onPress={() => open({image, label, returnFocus: () => opener.current?.focus()})}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.expand}>
      <Icon name="fullscreen" color={hovered ? color.text : color.muted} size={14} />
    </Pressable>
  </View>;
}

export function ToolResultImages({images, label}: {images: ToolImage[]; label: string}) {
  const s = useThemeStyles(makeStyles);
  if (!images.length) return null;
  return <View style={s.images}>{images.map((image, index) => <ToolResultImage
    key={`${image.mimeType}:${image.data.length}:${image.data.slice(-24)}:${index}`} image={image}
    label={images.length === 1 ? label : `${label} (${index + 1} of ${images.length})`} />)}</View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: {flex: 1}, images: {marginTop: 4, gap: 4},
  frame: {minHeight: 64, width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 4, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg},
  expand: {position: 'absolute', top: 4, right: 4, padding: 4, borderRadius: 4, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated},
  overlay: {...StyleSheet.absoluteFillObject, zIndex: 100, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#00000080'},
  dialog: {width: '95%', height: '90%', padding: 24, gap: 8, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 8, backgroundColor: palette.content},
  dialogHeader: {flexDirection: 'row', alignItems: 'center', gap: 8}, title: {flex: 1, fontFamily: 'Geist SemiBold', fontSize: 16, color: palette.text},
  close: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4}, hovered: {backgroundColor: palette.hover},
  fullImageFrame: {flex: 1, backgroundColor: palette.bg}, fullImage: {width: '100%', height: '100%'},
  attachmentDialog: {width: 'auto', height: 'auto', maxWidth: '95%', maxHeight: '90%', padding: 16, borderColor: palette.border, backgroundColor: palette.elevated},
  attachmentTitle: {flex: 0, flexShrink: 1, paddingRight: 24, fontSize: 14, lineHeight: 17.5}, attachmentClose: {position: 'absolute', top: 12, right: 12},
  attachmentFrame: {flex: 0, alignSelf: 'center', backgroundColor: 'transparent'}, attachmentImage: {borderRadius: 4},
});
