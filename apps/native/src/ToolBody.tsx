import {type ReactNode, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useChatFold} from './chatFolds';
import type {ToolStep} from './chatActivityModel';
import {countToolLines, editLines, readRange, toolFileLanguage, toolFileLinkEnabled, toolFileReference} from './toolFilePaths';
import {HighlightedCode} from './HighlightedCode';
import {Icon, type IconName} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

function LongContent({id, lines, children}: {id: string; lines: number; children: ReactNode}) {
  const s = useThemeStyles(makeStyles);
  const [expanded, toggle] = useChatFold(id);
  const [hovered, setHovered] = useState(false);
  return <View style={s.body}><View style={lines > 24 && !expanded ? s.clipped : undefined}>{children}</View>
    {lines > 24 ? <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={toggle}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.expand}>
      <Text style={[s.link, hovered && s.underlined]}>{expanded ? 'Show less' : `Show all ${lines} lines`}</Text>
    </Pressable> : null}</View>;
}

function Code({text, language = '', error = false}: {text: string; language?: string; error?: boolean}) {
  const s = useThemeStyles(makeStyles);
  return <ScrollView horizontal style={[s.codeScroll, error && s.errorCode, {height: Math.max(1, countToolLines(text)) * 20 + (error ? 8 : 16)}]}
    contentContainerStyle={[s.codeBody, error && s.errorCodeBody]}>
    {language && !error ? <HighlightedCode code={text} language={language} style={s.code} />
      : <Text selectable style={[s.code, error && s.error]}>{text}</Text>}
  </ScrollView>;
}

function FileHeader({step, root, status, onOpenFile}: {
  step: ToolStep; root: string; status: 'running' | 'done' | 'error'; onOpenFile: (path: string) => void;
}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState(false);
  const path = typeof step.args.path === 'string' ? step.args.path : '';
  const reference = toolFileReference(path, root);
  const enabled = reference.target !== null && toolFileLinkEnabled(step.name, status);
  const icon: IconName = step.name === 'edit' ? 'pencil' : step.name === 'write' ? 'fileAdd' : 'fileText';
  const detail = step.name === 'read' ? readRange(step.args) : step.name === 'edit' ? 'edited' : 'written';
  return <View style={s.fileHeader}><Icon name={icon} color={step.name === 'edit' ? color.warning : step.name === 'write' ? color.success : color.muted} size={12} />
    {enabled ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${reference.label}`} style={s.fileLink}
      onPress={() => {if (reference.target) onOpenFile(reference.target);}} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}>
      <Text numberOfLines={1} style={[s.fileText, step.name === 'read' && s.link, hovered && s.underlined]}>{reference.label}</Text>
    </Pressable> : <Text selectable numberOfLines={1} style={[s.fileText, s.fileLink, step.name === 'read' && s.link]}>{reference.label}</Text>}
    {detail ? <Text style={s.detail}>{detail}</Text> : null}
  </View>;
}

export function ToolBody({step, root, scope, status, output, onOpenFile}: {
  step: ToolStep; root: string; scope: string; status: 'running' | 'done' | 'error'; output: string; onOpenFile: (path: string) => void;
}) {
  const s = useThemeStyles(makeStyles);
  const contentId = `${scope}:${step.id}:content`;
  if (step.name === 'bash') return <View style={s.bash}>
    <View style={s.command}><Text style={[s.code, s.success]}>$</Text><Text selectable style={[s.code, s.commandText]}>{typeof step.args.command === 'string' ? step.args.command : ''}</Text></View>
    <Code text={output || (status === 'running' ? 'Running…' : '(no output)')} error={status === 'error'} />
  </View>;
  if (step.name === 'read' || step.name === 'write' || step.name === 'edit') {
    const content = step.name === 'write' ? typeof step.args.content === 'string' ? step.args.content : '' : output;
    const edit = editLines(step.args);
    return <View style={s.body}><FileHeader step={step} root={root} status={status} onOpenFile={onOpenFile} />
      {status === 'error' ? <Code text={output} error />
        : step.name === 'read' && status === 'running' ? <Text style={s.detail}>Reading…</Text>
          : step.name === 'edit' ? <LongContent id={contentId} lines={edit.old.length + edit.next.length}>
            <ScrollView horizontal style={[s.diff, {height: (edit.old.length + edit.next.length) * 20 + 2}]} contentContainerStyle={s.diffContent}>
              <View style={s.diffLines}>{edit.old.map((line, index) => <View key={`old:${index}`} style={[s.diffRow, s.removed]}>
                <Text style={[s.sign, s.error]}>−</Text><Text selectable style={[s.code, s.error]}>{line || ' '}</Text></View>)}
                {edit.next.map((line, index) => <View key={`next:${index}`} style={[s.diffRow, s.added]}>
                  <Text style={[s.sign, s.success]}>+</Text><Text selectable style={[s.code, s.success]}>{line || ' '}</Text></View>)}</View>
            </ScrollView>
          </LongContent>
            : content ? <LongContent id={contentId} lines={countToolLines(content)}>
              <Code text={content} language={toolFileLanguage(typeof step.args.path === 'string' ? step.args.path : '')} />
            </LongContent>
              : <Text style={s.detail}>(empty file)</Text>}
    </View>;
  }
  return <View style={s.body}><Text selectable style={s.detail}>{JSON.stringify(step.args, null, 2)}</Text>
    {output ? <Code text={output} error={status === 'error'} /> : <Text style={s.detail}>{status === 'running' ? 'Running…' : '(no text output)'}</Text>}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  body: {gap: 4}, clipped: {maxHeight: 384, overflow: 'hidden'}, expand: {alignSelf: 'flex-start'},
  link: {color: palette.accent}, underlined: {textDecorationLine: 'underline'}, detail: {fontFamily: 'Geist Native Text', fontSize: 11, color: palette.muted},
  fileHeader: {flexDirection: 'row', alignItems: 'center', gap: 4}, fileLink: {flexShrink: 1}, fileText: {fontFamily: 'Geist Native Text', fontSize: 11, color: palette.text},
  codeScroll: {backgroundColor: palette.surface, borderRadius: 4}, errorCode: {backgroundColor: 'transparent'},
  codeBody: {padding: 8, minWidth: '100%'}, errorCodeBody: {paddingVertical: 4}, code: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20, color: palette.text},
  error: {color: palette.red}, success: {color: palette.success}, bash: {borderWidth: 1, borderColor: palette.border, borderRadius: 4, overflow: 'hidden', backgroundColor: palette.surface},
  command: {paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderColor: palette.border, flexDirection: 'row', gap: 8},
  commandText: {color: palette.muted, flexShrink: 1},
  diff: {borderWidth: 1, borderColor: palette.border, borderRadius: 4}, diffContent: {minWidth: '100%'}, diffLines: {flexGrow: 1}, diffRow: {flexDirection: 'row', paddingRight: 4},
  removed: {backgroundColor: `${palette.red}1f`}, added: {backgroundColor: `${palette.success}1f`}, sign: {width: 24, paddingHorizontal: 4, textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20},
});
