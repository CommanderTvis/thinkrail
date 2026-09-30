import {NativeModules} from 'react-native';
import type {PatternScanner} from 'shiki/core';
import {createCodeHighlighter} from './syntaxHighlighter';

type ScanResult = ReturnType<PatternScanner['findNextMatchSync']>;
type ScannerModule = {
  createScanner: (patterns: string[]) => {id: number; error?: undefined} | {error: string; id?: undefined};
  scan: (id: number, text: string, start: number, options: number) => ScanResult;
  disposeScanner: (id: number) => void;
};
const native = NativeModules.NativeOniguruma as ScannerModule;
export const highlightCode = createCodeHighlighter({
  createScanner(patterns) {
    const result = native.createScanner(patterns.map(pattern => typeof pattern === 'string' ? pattern : pattern.source));
    if (result.error !== undefined) throw new Error(result.error);
    return {
      findNextMatchSync(text, start, options) {
        return native.scan(result.id, typeof text === 'string' ? text : text.content, start, options ?? 0);
      },
      dispose() {native.disposeScanner(result.id);},
    };
  },
  createString(content) {return {content};},
});

export async function probeNativeHighlighting() {
  const examples = {
    typescript: 'const value: number = 42;', tsx: 'const view = <div title="test" />;',
    javascript: 'const value = "Привет 👋";\n\n// comment', jsx: 'const view = <div />;', json: '{"key": 42}',
    bash: 'echo "$HOME"', python: 'def example():\n    return "hello"', css: '.class { color: red; }',
    html: '<div title="test">Hello</div>', markdown: '# Heading\n\n**Bold**', diff: '+added\n-removed', yaml: 'key: value',
  };
  return Promise.all(Object.entries(examples).map(async ([lang, code]) => {
    const tokens = await highlightCode(code, lang);
    if (!tokens || tokens.map(line => line.map(token => token.content).join('')).join('\n') !== code) {
      throw new Error(`Native highlighting failed: ${lang}`);
    }
    return {lang, tokenCount: tokens.flat().length, colors: [...new Set(tokens.flat().map(token => token.color))]};
  }));
}
