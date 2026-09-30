import {useEffect, useState} from 'react';
import {Text, type TextStyle} from 'react-native';
import type {ThemedToken} from 'shiki/core';
import {useThemeId} from './Theme';
import {themeChoices} from './themePalette';
import {syntaxColor} from './syntaxColors';

export function HighlightedCode({code, language, style}: {code: string; language: string; style: TextStyle}) {
  const themeId = useThemeId();
  const syntax = (themeChoices.find(theme => theme.id === themeId) ?? themeChoices[0]).syntax;
  const [result, setResult] = useState<{code: string; language: string; tokens: ThemedToken[][] | null}>();
  useEffect(() => {
    if (!language) return;
    let active = true;
    import('./nativeSyntaxHighlighter').then(module => module.highlightCode(code, language)).then(tokens => {
      if (active) setResult({code, language, tokens});
    }).catch(() => {if (active) setResult({code, language, tokens: null});});
    return () => {active = false;};
  }, [code, language]);
  const tokens = result?.code === code && result.language === language ? result.tokens : null;
  return <Text selectable style={style}>{tokens ? tokens.map((line, lineIndex) =>
    <Text key={lineIndex}>{lineIndex > 0 ? '\n' : ''}{line.map((token, index) =>
      <Text key={index} style={{color: syntaxColor(token.color, syntax)}}>{token.content}</Text>)}</Text>) : code}</Text>;
}
