import {type ReactNode, useEffect, useRef, useState} from 'react';
import {Clipboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type View as NativeView} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {useChatFold} from './chatFolds';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import type {ChatAttachment} from './messageActionModel';
import {useImagePreview} from './ToolResultImages';
import {MarkdownText} from './MarkdownText';
import {tid} from './testId';
import {parseSkillInvocation, type SkillInvocation} from './skillInvocation';
import {keyReviewItems, parseReviewPackage, reviewPackageLabel, type ReviewFixCardData, type ReviewPackage, type ReviewPackageItem} from './reviewPackageModel';

function AttachmentChip({attachment}: {attachment: ChatAttachment}) {
  const s = useThemeStyles(makeStyles);
  const open = useImagePreview();
  const opener = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <Pressable ref={opener} {...tid('chat-attachment-chip')} accessibilityRole="button" accessibilityLabel={`View attachment ${attachment.label}`}
    onPress={() => open({image: attachment.image, label: attachment.label, attachment: true, returnFocus: () => opener.current?.focus()})}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.chip, hovered && s.hovered]}>
    <Icon name="file" size={12} color={color.text} /><Text numberOfLines={1} style={s.chipLabel}>{attachment.label}</Text>
    {focused ? <View pointerEvents="none" style={s.focusRing} /> : null}
  </Pressable>;
}

export function MessageWithCopy({text, side, children}: {text: string; side: 'left' | 'right'; children: ReactNode}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [buttonHovered, setButtonHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {if (timer.current) clearTimeout(timer.current);}, []);
  const copy = async () => {
    try {
      Clipboard.setString(text);
      if (await Clipboard.getString() !== text) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return <MacView onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={[s.wrapper, side === 'right' && s.userWrapper]}>
    {children}
    <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={copy}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setButtonHovered(true)} onHoverOut={() => setButtonHovered(false)}
      style={[s.copy, side === 'right' ? s.userCopy : s.assistantCopy, !(hovered || focused || copied) && s.hidden, buttonHovered && s.hovered]}>
      <Icon name={copied ? 'check' : 'copy'} color={buttonHovered ? color.text : color.muted} size={14} />
    </Pressable>
  </MacView>;
}

type UserMessageProps = {id: string; text: string; attachments: ChatAttachment[]; agentResponded: boolean};

export function UserMessage(props: UserMessageProps) {
  const skill = parseSkillInvocation(props.text);
  if (skill) return <SkillMessage id={props.id} skill={skill} />;
  const review = parseReviewPackage(props.text);
  return review ? <ReviewMessage id={props.id} review={review} attachments={props.attachments} /> : <PlainUserMessage {...props} />;
}

function ReviewMessage({id, review, attachments}: {id: string; review: ReviewPackage; attachments: ChatAttachment[]}) {
  const s = useThemeStyles(makeStyles);
  return <View style={s.userWrapper}><View style={[s.userBubble, s.skillRequest]}>
    {attachments.length ? <View {...tid('chat-message-images')} style={s.attachments}>{attachments.map(attachment => <AttachmentChip key={attachment.key} attachment={attachment} />)}</View> : null}
    <Text selectable style={s.reviewSummary}>{reviewPackageLabel(review)}</Text>
    <ReviewComments id={id} items={review.items} />
  </View></View>;
}

export function ReviewFixCard({id, review}: {id: string; review: ReviewFixCardData}) {
  const s = useThemeStyles(makeStyles);
  return <View style={s.reviewFixRow}><View style={[s.userBubble, s.skillRequest, s.reviewFixCard]}>
    <Text selectable style={s.reviewSummary}>{review.summary}</Text>
    {review.note ? <Text selectable style={[s.userText, s.reviewNote]}>{review.note}</Text> : null}
    {review.items.length ? <ReviewComments id={id} items={review.items} /> : null}
  </View></View>;
}

function ReviewComments({id, items}: {id: string; items: ReviewPackageItem[]}) {
  const s = useThemeStyles(makeStyles);
  return <View style={s.reviewComments}>{keyReviewItems(items).map(({key, item}) => <ReviewCommentRow key={key} id={`${id}:${key}`} item={item} />)}</View>;
}

function ReviewCommentRow({id, item}: {id: string; item: ReviewPackageItem}) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(id);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${item.lineRef} ${item.body}`.trim()} onPress={toggle}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.reviewToggle, hovered && s.hovered]}>
      <View style={[s.reviewChevron, expanded && s.reviewChevronExpanded]}><Icon name="arrowRight" size={16} color={color.hint} /></View>
      {item.lineRef ? <Text style={s.reviewLine}>{item.lineRef}</Text> : null}
      <Text numberOfLines={expanded ? undefined : 1} style={s.reviewBody}>{expanded ? item.body : item.body.replace(/\s+/g, ' ').trim()}</Text>
      {focused ? <View pointerEvents="none" style={[s.focusRing, s.skillFocus]} /> : null}
    </Pressable>
    {expanded && item.fragment ? <ScrollView style={s.reviewFragment} contentContainerStyle={s.reviewFragmentContent}>
      <Text selectable style={s.reviewCode}>{item.fragment}</Text>
    </ScrollView> : null}
  </View>;
}

function SkillMessage({id, skill}: {id: string; skill: SkillInvocation}) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(`${id}:skill`);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <View style={s.skillRow}><View style={s.skillCard}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded}}
      accessibilityLabel={`${expanded ? 'Hide' : 'Show'} instructions for ${skill.name}`} onPress={toggle}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.skillHeader, hovered && s.hovered]}>
      <Icon name="book" size={14} color={color.muted} /><Text style={s.skillLabel}>Skill</Text><Text style={s.skillSeparator}>·</Text>
      <Text numberOfLines={1} style={s.skillName}>{skill.name}</Text>
      <View style={s.skillChevron}><Icon name={expanded ? 'arrowDown' : 'arrowRight'} size={16} color={color.muted} /></View>
      {focused ? <View pointerEvents="none" style={[s.focusRing, s.skillFocus]} /> : null}
    </Pressable>
    {expanded ? <View style={s.skillContent}><MarkdownText text={skill.content} compact /></View> : null}
  </View>{skill.userMessage ? <View style={[s.userBubble, s.skillRequest]}><Text selectable style={s.userText}>{skill.userMessage}</Text></View> : null}</View>;
}

function PlainUserMessage({id, text, attachments, agentResponded}: UserMessageProps) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(`${id}:user-collapse`, !agentResponded);
  const [hovered, setHovered] = useState(false);
  const window = useWindowDimensions();
  const large = text.length > 500;
  const collapsed = large && !expanded;
  const body = text ? <Text selectable numberOfLines={collapsed ? 3 : undefined} style={s.userText}>{text}</Text> : null;
  return <MessageWithCopy text={text} side="right"><View style={s.userBubble}>
    {attachments.length ? <View {...tid('chat-message-images')} style={s.attachments}>{attachments.map(attachment => <AttachmentChip key={attachment.key} attachment={attachment} />)}</View> : null}
    {large && expanded ? <ScrollView style={[s.longBody, {maxHeight: window.height * 0.6}]}>{body}</ScrollView> : body}
    {large ? <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={toggle}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.toggle}>
      <View style={expanded ? s.up : undefined}><Icon name="arrowDown" color={hovered ? color.text : color.hint} size={16} /></View>
      <Text style={[s.toggleText, hovered && s.toggleHovered]}>{expanded ? 'Show less' : 'Show more'}</Text>
    </Pressable> : null}
  </View></MessageWithCopy>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrapper: {position: 'relative', width: '100%'}, userWrapper: {alignItems: 'flex-end'},
  copy: {position: 'absolute', zIndex: 1, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  userCopy: {right: 0, bottom: 8}, assistantCopy: {left: 0, bottom: 0}, hidden: {opacity: 0}, hovered: {backgroundColor: palette.hover},
  userBubble: {maxWidth: '85%', paddingLeft: 12, paddingRight: 24, paddingVertical: 8, borderWidth: 1, borderColor: palette.bubbleUserBorder, borderRadius: 8, backgroundColor: palette.bubbleUserBg},
  userText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 22.4},
  longBody: {flexGrow: 0},
  attachments: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingBottom: 4},
  chip: {maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, paddingHorizontal: 8, paddingVertical: 4},
  chipLabel: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.text, flexShrink: 1},
  focusRing: {position: 'absolute', top: -2, right: -2, bottom: -2, left: -2, borderWidth: 2, borderRadius: 5, borderColor: palette.accent},
  skillRow: {width: '100%', alignItems: 'flex-end', gap: 4},
  skillCard: {maxWidth: '85%', overflow: 'hidden', borderWidth: 1, borderColor: palette.bubbleUserBorder, borderRadius: 8, backgroundColor: palette.bubbleUserBg},
  skillHeader: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8},
  skillLabel: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.muted}, skillSeparator: {color: palette.hint, fontFamily: 'Geist Native Text', fontSize: 14},
  skillName: {minWidth: 0, flexShrink: 1, fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20, color: palette.text}, skillChevron: {marginLeft: 'auto'},
  skillContent: {borderTopWidth: 1, borderColor: palette.bubbleUserBorder, paddingHorizontal: 12, paddingVertical: 8},
  skillRequest: {paddingRight: 12}, skillFocus: {...StyleSheet.absoluteFillObject},
  reviewSummary: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 22.4, color: palette.text}, reviewComments: {marginTop: 4},
  reviewFixRow: {alignItems: 'flex-start'}, reviewFixCard: {overflow: 'hidden'}, reviewNote: {marginTop: 4},
  reviewToggle: {flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingHorizontal: 4, paddingVertical: 4, borderRadius: 4},
  reviewChevron: {marginTop: 2}, reviewChevronExpanded: {transform: [{rotate: '90deg'}]},
  reviewLine: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20, color: palette.hint},
  reviewBody: {minWidth: 0, flex: 1, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 22.4, color: palette.text},
  reviewFragment: {flexGrow: 0, maxHeight: 128, marginLeft: 16, marginBottom: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.sunken},
  reviewFragmentContent: {paddingHorizontal: 8, paddingVertical: 4}, reviewCode: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20, color: palette.muted},
  toggle: {marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4}, up: {transform: [{rotate: '180deg'}]},
  toggleText: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.hint}, toggleHovered: {color: palette.text},
});
