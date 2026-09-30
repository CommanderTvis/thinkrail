import {cloneElement, isValidElement, useEffect, useMemo, useState, type ReactNode} from 'react';
import Markdown, {MarkdownIt, renderRules, type ASTNode} from 'react-native-markdown-display';
import {Image, Linking, ScrollView, StyleSheet, Text, View, type TextProps, type TextStyle, type ViewProps, type ViewStyle} from 'react-native';
import {HighlightedCode} from './HighlightedCode';
import {hostClient} from './HostClient';
import {collapsedBlockMargins, enableParagraphSpacing, inlineCodeSize, listMarker, markdownContent, markdownOptions, paragraphMargin} from './markdownFormatting';
import {scrollToMarkdownHeading, type MarkdownAnchors} from './markdownAnchors';
import {classifyHref, resolveRelativePath} from './markdownPaths';
import {Icon, type IconName} from './Icon';
import {enableGithubAlerts, type AlertVariant} from './markdownAlerts';
import {enableHeadingIds} from './markdownHeadingIds';
import {tableColumnWidths} from './markdownTables';
import {enableTaskLists} from './markdownTasks';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

const chatMarkdown = new MarkdownIt(markdownOptions).use(enableTaskLists).use(enableParagraphSpacing);
const documentMarkdown = new MarkdownIt(markdownOptions).use(enableGithubAlerts).use(enableHeadingIds).use(enableTaskLists).use(enableParagraphSpacing);
const alertLabels: Record<AlertVariant, {label: string; icon: IconName}> = {
  note: {label: 'Note', icon: 'alertNote'}, tip: {label: 'Tip', icon: 'alertTip'},
  important: {label: 'Important', icon: 'alertImportant'}, warning: {label: 'Warning', icon: 'alertWarning'},
  caution: {label: 'Caution', icon: 'alertCaution'},
};

const createMarkdownStyles = (palette: Palette, document: boolean) => StyleSheet.create({
  body: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 22.4},
  paragraph: {marginTop: document ? 12 : 8, marginBottom: document ? 12 : 8, flexDirection: 'row', flexWrap: 'wrap'},
  heading1: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: document ? 24 : 18, lineHeight: document ? 30 : 22.5, marginTop: 0, marginBottom: document ? 12 : 0, borderBottomWidth: document ? 1 : 0, borderColor: palette.border, paddingBottom: document ? 4 : 0},
  heading2: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: document ? 20 : 14, lineHeight: document ? 25 : 17.5, marginTop: document ? 24 : 0, marginBottom: document ? 12 : 0, borderBottomWidth: document ? 1 : 0, borderColor: palette.border, paddingBottom: document ? 4 : 0},
  heading3: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: document ? 18 : 12, lineHeight: document ? 22.5 : 19.2, marginTop: document ? 16 : 0, marginBottom: document ? 8 : 0},
  heading4: {fontFamily: document ? 'Geist SemiBold' : 'Geist Medium', color: palette.text, fontSize: document ? 16 : 12, lineHeight: document ? 20 : 19.2, marginTop: document ? 16 : 0, marginBottom: document ? 8 : 0},
  heading5: {fontFamily: document ? 'Geist SemiBold' : 'Geist Medium', color: palette.text, fontSize: document ? 14 : 12, lineHeight: document ? 17.5 : 19.2, marginTop: document ? 12 : 0, marginBottom: document ? 4 : 0},
  heading6: {fontFamily: document ? 'Geist SemiBold' : 'Geist Medium', color: document ? palette.muted : palette.text, fontSize: document ? 12 : 10, lineHeight: document ? 19.2 : 16, letterSpacing: document ? 0 : 0.5, textTransform: 'uppercase', marginTop: document ? 12 : 0, marginBottom: document ? 4 : 0},
  strong: {fontFamily: 'Geist Medium', color: palette.text, fontWeight: '500'},
  em: {fontStyle: 'italic'},
  link: {color: palette.accent, textDecorationLine: 'underline'},
  bullet_list: {marginVertical: document ? 12 : 8}, ordered_list: {marginVertical: document ? 12 : 8},
  nestedList: {marginVertical: 4},
  listMarkerFrame: {width: document ? 22.4 : 16, height: 22.4},
  listMarkerText: {position: 'absolute', right: 4, textAlign: 'right', fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 22.4},
  taskRow: {paddingLeft: document ? 22.4 : 16},
  list_item: {marginVertical: document ? 4 : 2, flexDirection: 'row'},
  taskBox: {width: 14, height: 14, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 3, marginRight: 4, marginTop: 4, alignItems: 'center', justifyContent: 'center'},
  taskBoxChecked: {borderColor: palette.accentSolid, backgroundColor: palette.accentSolid},
  blockquote: {color: document ? palette.muted : palette.text, borderLeftWidth: document ? 2 : 0, borderColor: palette.primaryMuted, paddingLeft: document ? 12 : 0, marginVertical: document ? 12 : 0, backgroundColor: 'transparent'},
  code_inline: {color: palette.text, backgroundColor: palette.elevated, fontFamily: 'JetBrains Mono', fontWeight: '400', fontSize: 13, lineHeight: 20, borderWidth: 0, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 2},
  codeFrame: {backgroundColor: palette.elevated, borderRadius: 4, marginVertical: document ? 12 : 0},
  codeContent: {padding: 8}, codeText: {color: palette.text, fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: document ? 19.5 : 20},
  mediaFrame: {marginVertical: document ? 12 : 0},
  table: {width: '100%', borderWidth: 0, marginVertical: document ? 12 : 0},
  tableContent: {borderTopWidth: 1, borderLeftWidth: 1, borderColor: palette.border},
  tr: {flexDirection: 'row', borderBottomWidth: 0}, trStriped: {backgroundColor: palette.sunken},
  th: {fontFamily: 'Geist SemiBold', flex: 0, color: palette.text, fontSize: document ? 14 : 12, lineHeight: document ? 17.5 : 19.2, backgroundColor: document ? palette.elevated : 'transparent', paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: palette.border},
  td: {fontFamily: 'Geist Native Text', flex: 0, color: palette.text, fontSize: document ? 14 : 12, lineHeight: document ? 22.4 : 16, paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: palette.border},
  hr: {height: 1, backgroundColor: palette.border, marginVertical: document ? 24 : 0},
});

const makeChatStyles = (palette: Palette) => createMarkdownStyles(palette, false);
const makeDocumentStyles = (palette: Palette) => createMarkdownStyles(palette, true);

const makeImageStyles = (palette: Palette) => StyleSheet.create({
  frame: {width: '100%'},
  image: {borderRadius: 4},
  fallback: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 11},
});

const makeAlertStyles = (palette: Palette) => StyleSheet.create({
  frame: {paddingHorizontal: 12, paddingVertical: 8, borderLeftWidth: 2, borderTopRightRadius: 4, borderBottomRightRadius: 4},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 4, marginVertical: 4},
  label: {fontFamily: 'Geist SemiBold', fontSize: 14, lineHeight: 17.5, color: palette.text},
});

function isAlertVariant(value: unknown): value is AlertVariant {
  return typeof value === 'string' && Object.hasOwn(alertLabels, value);
}

function AlertCallout({variant, children, style}: {variant: AlertVariant; children: ReactNode[]; style?: ViewProps['style']}) {
  const styles = useThemeStyles(makeAlertStyles);
  const tint = variant === 'note' ? color.blue : variant === 'tip' ? color.success : variant === 'important' ? color.accent
    : variant === 'warning' ? color.warning : color.red;
  const {label, icon} = alertLabels[variant];
  return <View style={[styles.frame, {borderLeftColor: tint, backgroundColor: `${tint}1a`}, style]}>
    {flowChildren([<View key="heading" style={styles.heading}><Icon name={icon} size={16} color={tint} />
      <Text style={[styles.label, {color: tint}]}>{label}</Text></View>, ...children], false, true)}
  </View>;
}

function DocumentImage({source, alt, style}: {source?: string; alt: string; style?: ViewProps['style']}) {
  const imageStyles = useThemeStyles(makeImageStyles);
  const [size, setSize] = useState<{width: number; height: number}>();
  const [availableWidth, setAvailableWidth] = useState(760);
  useEffect(() => {
    if (!source) return;
    let active = true;
    setSize(undefined);
    Image.getSize(source, (width, height) => {if (active) setSize({width, height});}, () => {});
    return () => {active = false;};
  }, [source]);
  const width = size ? Math.min(size.width, availableWidth) : 0;
  return <View style={[imageStyles.frame, style]} onLayout={event => setAvailableWidth(current => current === event.nativeEvent.layout.width ? current : event.nativeEvent.layout.width)}>
    {source && size ? <Image source={{uri: source}} accessibilityLabel={alt} resizeMode="contain"
      style={[imageStyles.image, {width, height: width * size.height / size.width}]} />
      : alt ? <Text style={imageStyles.fallback}>{alt}</Text> : null}
  </View>;
}

function imageSource(path: string | undefined, source: string) {
  const kind = classifyHref(source);
  if (kind === 'external') return /^https?:\/\//i.test(source) ? source : undefined;
  if (kind === 'relative' && path) {
    const resolved = resolveRelativePath(path, source);
    return resolved ? hostClient.fileURL(resolved) : undefined;
  }
  return undefined;
}

function headingRule(level: number, layout: MarkdownAnchors) {
  return (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: Record<string, ViewStyle>) =>
    <View key={node.key} collapsable={typeof node.attributes.id !== 'string'} style={styles[`_VIEW_SAFE_heading${level}`]} ref={view => {
      const id = node.attributes.id;
      if (typeof id === 'string') {
        if (view) layout.headings.set(id, view);
        else layout.headings.delete(id);
      }
    }}>{children}</View>;
}

function selectableTextRule(name: 'inline' | 'textgroup') {
  const rule = renderRules[name]!;
  return (...args: Parameters<typeof rule>) => {
    const rendered = rule(...args);
    return isValidElement<TextProps>(rendered) ? cloneElement(rendered, {selectable: true}) : rendered;
  };
}

function childMargins(child: ReactNode) {
  const style = isValidElement<ViewProps>(child) ? StyleSheet.flatten(child.props.style) : undefined;
  return {top: Number(style?.marginTop ?? style?.marginVertical ?? style?.margin ?? 0),
    bottom: Number(style?.marginBottom ?? style?.marginVertical ?? style?.margin ?? 0)};
}

function flowChildren(children: ReactNode[], trimFirst: boolean, trimLast: boolean) {
  const margins = collapsedBlockMargins(children.map(childMargins), trimFirst, trimLast);
  return children.map((child, index) => isValidElement<ViewProps>(child)
    ? cloneElement(child, {style: [child.props.style, margins[index]]}) : child);
}

function codeBlockRule(node: ASTNode & {sourceInfo?: string}, _children: ReactNode[], _parents: ASTNode[], styles: Record<string, ViewStyle & TextStyle>) {
  return <ScrollView key={node.key} horizontal style={styles._VIEW_SAFE_codeFrame} contentContainerStyle={styles._VIEW_SAFE_codeContent}>
    <HighlightedCode code={node.content.replace(/\n$/, '')} language={node.sourceInfo?.trim().split(/\s/, 1)[0] ?? ''} style={styles.codeText} />
  </ScrollView>;
}

function markdownRules(path: string | undefined, layout: MarkdownAnchors, trimTrailingSpace: boolean) {
  const tableWidths = new WeakMap<ASTNode, number[]>();
  const widthsFor = (table: ASTNode) => {
    let widths = tableWidths.get(table);
    if (!widths) {
      widths = tableColumnWidths(table);
      tableWidths.set(table, widths);
    }
    return widths;
  };
  const cellWidth = (node: ASTNode, parents: ASTNode[]) => {
    const table = parents.find(parent => parent.type === 'table');
    const index = parents[0]?.children.indexOf(node) ?? node.index;
    return table ? widthsFor(table)[index] ?? 80 : 80;
  };
  const listRule = (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) =>
    <View key={node.key} style={[styles[`_VIEW_SAFE_${node.type}`], path && parents[0]?.type === 'list_item' && styles.nestedList]}>
      {flowChildren(children, true, true)}
    </View>;
  const paragraphRule = (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) => {
    const margin = paragraphMargin(Boolean(path), node.attributes.tight === 'true', parents);
    return <View key={node.key} style={[styles._VIEW_SAFE_paragraph, {marginTop: margin, marginBottom: margin}]}>{children}</View>;
  };
  return {
    body: (node: ASTNode, children: ReactNode[], _parents: ASTNode[], styles: Record<string, ViewStyle>) =>
      <View key={node.key} collapsable={!path} ref={view => {layout.root = view;}}
        style={styles._VIEW_SAFE_body}>{flowChildren(children, Boolean(path), Boolean(path) || trimTrailingSpace)}</View>,
    inline: selectableTextRule('inline'), textgroup: selectableTextRule('textgroup'),
    paragraph: paragraphRule, list_paragraph: paragraphRule,
    code_inline: (node: ASTNode, _children: ReactNode[], parents: ASTNode[], styles: Record<string, TextStyle>, inheritedStyles: TextStyle) =>
      <Text key={node.key} style={[inheritedStyles, styles.code_inline, inlineCodeSize(Boolean(path), parents)]}>{node.content}</Text>,
    bullet_list: listRule, ordered_list: listRule,
    code_block: codeBlockRule, fence: codeBlockRule,
    image: (node: ASTNode, _children: ReactNode[], _parents: ASTNode[], styles: Record<string, ViewStyle>) => {
      const source = typeof node.attributes.src === 'string' ? node.attributes.src : '';
      const alt = typeof node.attributes.alt === 'string' ? node.attributes.alt : '';
      return <DocumentImage key={node.key} source={imageSource(path, source)} alt={alt} style={styles._VIEW_SAFE_mediaFrame} />;
    }, softbreak: (node: ASTNode, _children: ReactNode[], _parents: ASTNode[], styles: Record<string, ViewStyle>) => {
      return <Text key={node.key} style={styles.softbreak}> </Text>;
    }, blockquote: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: Record<string, ViewStyle>) => {
    const variant = node.attributes.alert;
    return path && isAlertVariant(variant) ? <AlertCallout key={node.key} variant={variant} style={styles._VIEW_SAFE_mediaFrame}>{children}</AlertCallout>
      : <View key={node.key} style={styles._VIEW_SAFE_blockquote}>{flowChildren(children, Boolean(path), Boolean(path))}</View>;
  }, list_item: (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) => {
    const checked = node.attributes.taskChecked;
    const task = checked === 'true' || checked === 'false';
    const marker = listMarker(node.index, parents);
    const edgeMargins = {marginTop: Math.max(path ? 4 : 2, childMargins(children[0]).top),
      marginBottom: Math.max(path ? 4 : 2, childMargins(children.at(-1)).bottom)};
    return <View key={node.key} style={[styles._VIEW_SAFE_list_item, edgeMargins, task && styles.taskRow]}>
      {task ? <View accessible accessibilityRole="checkbox" accessibilityState={{checked: checked === 'true'}}
        style={[styles.taskBox, checked === 'true' && styles.taskBoxChecked]}>
        {checked === 'true' ? <Icon name="check" size={11} color={color.onAccent} /> : null}
      </View> : <View style={styles.listMarkerFrame}><Text accessible={false}
        style={[styles.listMarkerText, {width: Math.max(16, marker.length * 9)}]}>{marker}</Text></View>}
      <View style={styles._VIEW_SAFE_bullet_list_content}>{flowChildren(children, true, true)}</View>
    </View>;
  }, table: (node: ASTNode, children: ReactNode[], _parents: ASTNode[], styles: Record<string, ViewStyle>) => {
    const width = widthsFor(node).reduce((sum, column) => sum + column, 0);
    return <ScrollView key={node.key} horizontal style={styles._VIEW_SAFE_table}>
      <View style={[styles.tableContent, {width}]}>{children}</View>
    </ScrollView>;
  }, tr: (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) =>
    <View key={node.key} style={[styles._VIEW_SAFE_tr, path && parents[0]?.type === 'tbody' && node.index % 2 === 1 && styles.trStriped]}>{children}</View>,
  th: (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) =>
    <View key={node.key} style={[styles._VIEW_SAFE_th, {width: cellWidth(node, parents)}]}>{children}</View>,
  td: (node: ASTNode, children: ReactNode[], parents: ASTNode[], styles: Record<string, ViewStyle>) =>
    <View key={node.key} style={[styles._VIEW_SAFE_td, {width: cellWidth(node, parents)}]}>{children}</View>,
  heading1: headingRule(1, layout), heading2: headingRule(2, layout), heading3: headingRule(3, layout),
  heading4: headingRule(4, layout), heading5: headingRule(5, layout), heading6: headingRule(6, layout)};
}

export function MarkdownText({text, path, compact = false, trimTrailingSpace = false, onScrollTo, onOpenFile}: {
  text: string; path?: string; compact?: boolean; trimTrailingSpace?: boolean; onScrollTo?: (y: number) => void; onOpenFile?: (path: string) => void;
}) {
  const common = useThemeStyles(compact ? makeChatStyles : makeDocumentStyles);
  const content = markdownContent(text, Boolean(path));
  const layout = useMemo<MarkdownAnchors>(() => ({text, path, root: null, headings: new Map()}), [text, path]);
  const rules = useMemo(() => markdownRules(path, layout, trimTrailingSpace), [path, layout, trimTrailingSpace]);
  return <Markdown style={common} markdownit={path ? documentMarkdown : chatMarkdown} onLinkPress={href => {
    const kind = classifyHref(href);
    if (kind === 'anchor' && onScrollTo) {
      scrollToMarkdownHeading(layout, href, onScrollTo);
    } else if (kind === 'external' && !/^javascript:/i.test(href)) {
      Linking.openURL(href.startsWith('//') ? `https:${href}` : href).catch(() => {});
    } else if (kind === 'relative' && path) {
      const resolved = resolveRelativePath(path, href);
      if (resolved) {
        if (onOpenFile) onOpenFile(resolved);
        else hostClient.openFile(resolved);
      }
    }
    return false;
  }} rules={rules}>{compact ? content.trim() : content}</Markdown>;
}
