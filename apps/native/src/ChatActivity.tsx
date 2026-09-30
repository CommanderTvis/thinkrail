import {type ReactNode, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {activitySteps, activitySummary, thinkingHeading, toolSummary, type ActivityStep, type ThinkingStep, type ToolResults, type ToolStep} from './chatActivityModel';
import {parseToolResultContent} from './toolResultContent';
import {ToolResultImages} from './ToolResultImages';
import {ToolBody} from './ToolBody';
import {useChatFold} from './chatFolds';
import {Icon, type IconName} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

function Disclosure({id, label, summary, headline, icon, live, children}: {
  id: string; label?: string; summary: string; headline?: string; icon: IconName; live?: boolean; children: ReactNode;
}) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(id);
  const [hovered, setHovered] = useState(false);
  return <View><Pressable accessibilityRole="button" accessibilityLabel={label ?? summary} accessibilityState={{expanded}}
    onPress={toggle}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.header, hovered && s.hovered]}>
    <Icon name={expanded ? 'arrowDown' : 'arrowRight'} color={color.muted} size={16} />
    {live ? <ActivityIndicator size="small" color={color.muted} style={s.spinner} /> : <Icon name={icon} color={color.muted} size={12} />}
    {label ? <Text numberOfLines={1} style={[s.label, !expanded && headline ? s.headline : undefined]}>{!expanded && headline ? headline : label}</Text> : null}
    <Text numberOfLines={1} style={s.summary}>{summary}</Text>
  </Pressable>{expanded ? <View style={s.children}>{children}</View> : null}</View>;
}

function ToolRow({step, results, scope, root, live, onOpenFile}: {step: ToolStep; results: ToolResults; scope: string; root: string; live: boolean; onOpenFile: (path: string) => void}) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(`${scope}:${step.id}`);
  const [hovered, setHovered] = useState(false);
  const result = results[step.id];
  const status = result?.status ?? (live ? 'running' : 'error');
  const output = parseToolResultContent(result?.raw);
  const summary = toolSummary(step, root);
  return <View><Pressable accessibilityRole="button" accessibilityLabel={step.name} accessibilityState={{expanded}}
    onPress={toggle}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.toolHeader, hovered && s.hovered]}>
    {status === 'running' ? <ActivityIndicator size="small" color={color.muted} style={s.spinner} />
      : <Icon name={status === 'error' ? 'close' : 'check'} color={status === 'error' ? color.red : color.success} size={12} />}
    <Text style={s.label}>{step.name}</Text><Text numberOfLines={1} style={s.summary}>{summary}</Text>
    <Icon name={expanded ? 'arrowDown' : 'arrowRight'} color={color.muted} size={16} />
  </Pressable>{expanded ? <View style={s.toolBody}>
    <ToolBody step={step} root={root} scope={scope} status={status} output={output.text} onOpenFile={onOpenFile} />
    {status !== 'running' ? <ToolResultImages images={output.images} label={summary || `${step.name} image output`} /> : null}
  </View> : null}</View>;
}

function ThinkingDisclosure({step, results, scope, root, live, running, onOpenFile}: {step: ThinkingStep; results: ToolResults; scope: string; root: string; live: boolean; running: boolean; onOpenFile: (path: string) => void}) {
  const s = useThemeStyles(makeStyles);
  const chars = step.text.length >= 1000 ? `${(step.text.length / 1000).toFixed(1)}k` : String(step.text.length);
  const summary = step.tools.length ? activitySummary(step.tools, live, root) : `${chars} chars`;
  return <Disclosure id={`${scope}:${step.id}`} label="Thinking" summary={summary} headline={thinkingHeading(step.text)} icon="brain" live={live}>
    <Text selectable style={s.thinking}>{step.text}</Text>
    {step.tools.map(tool => <ToolRow key={tool.id} step={tool} results={results} scope={scope} root={root} live={running} onOpenFile={onOpenFile} />)}
  </Disclosure>;
}

export function ChatActivity({content, rowId, scope, results, root, live, onOpenFile}: {
  content: unknown; rowId: string; scope: string; results: ToolResults; root: string; live: boolean; onOpenFile: (path: string) => void;
}) {
  const steps = activitySteps(content, rowId);
  const count = steps.reduce((total, step) => total + 1 + (step.kind === 'thinking' ? step.tools.length : 0), 0);
  const renderStep = (step: ActivityStep) => step.kind === 'thinking'
    ? <ThinkingDisclosure key={step.id} step={step} results={results} scope={scope} root={root} live={live && count === 1} running={live} onOpenFile={onOpenFile} />
    : <ToolRow key={step.id} step={step} results={results} scope={scope} root={root} live={live} onOpenFile={onOpenFile} />;
  if (!count) return null;
  if (count === 1) return renderStep(steps[0]);
  return <Disclosure id={`${scope}:${rowId}`} summary={activitySummary(steps, live, root)} icon="stack" live={live}>
    {steps.map(renderStep)}
  </Disclosure>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4, borderRadius: 4},
  toolHeader: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4},
  hovered: {backgroundColor: palette.hover}, children: {paddingLeft: 12, gap: 1}, spinner: {width: 12, height: 12},
  label: {fontFamily: 'Geist Native Text', fontSize: 11, color: palette.text}, headline: {flex: 1},
  summary: {fontFamily: 'Geist Native Text', fontSize: 11, color: palette.muted, flex: 1},
  thinking: {fontFamily: 'Geist Native Text', fontSize: 11, lineHeight: 16, color: palette.muted, paddingVertical: 4, paddingLeft: 16, paddingRight: 8},
  toolBody: {paddingLeft: 16, paddingRight: 8, paddingBottom: 4, gap: 4},
});
