import {createHighlighterCore, type HighlighterCore, type RegexEngine, type ThemedToken} from 'shiki/core';
import theme from './shiki-theme.json';

const languages = new Set(['typescript', 'tsx', 'javascript', 'jsx', 'json', 'bash', 'python', 'css', 'html', 'markdown', 'diff', 'yaml']);
const aliases: Record<string, string> = {ts: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', md: 'markdown', yml: 'yaml'};
export function createCodeHighlighter(engine: RegexEngine) {
  let highlighter: Promise<HighlighterCore> | undefined;

  function getHighlighter() {
    highlighter ??= createHighlighterCore({
      themes: [{...theme, type: 'dark'}],
      langs: [import('@shikijs/langs/typescript'), import('@shikijs/langs/tsx'), import('@shikijs/langs/javascript'),
        import('@shikijs/langs/jsx'), import('@shikijs/langs/json'), import('@shikijs/langs/bash'),
        import('@shikijs/langs/python'), import('@shikijs/langs/css'), import('@shikijs/langs/html'),
        import('@shikijs/langs/markdown'), import('@shikijs/langs/diff'), import('@shikijs/langs/yaml')],
      engine,
    });
    return highlighter;
  }

  return async function highlightCode(code: string, language: string): Promise<ThemedToken[][] | null> {
    const key = language.toLowerCase();
    const lang = aliases[key] ?? key;
    if (!languages.has(lang)) return null;
    try {
      return (await getHighlighter()).codeToTokens(code, {lang, theme: theme.name}).tokens;
    } catch {return null;}
  };
}
