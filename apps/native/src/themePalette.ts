import themes from './theme-colors.json';
import type {AppConfig} from './HostClient';

export type ThemeId = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export const themeChoices = themes as (typeof themes[number] & {id: ThemeId})[];

export function deriveThemePair(id: string): {light: ThemeId; dark: ThemeId} {
  const selected = themeChoices.find(theme => theme.id === id) ?? themeChoices[0];
  const high = selected.contrast === 'high';
  return {light: high ? 'high-contrast-light' : 'light', dark: high ? 'high-contrast-dark' : 'dark'};
}

export function resolveThemeId(config: Pick<AppConfig, 'theme' | 'themeMode' | 'systemThemePair'> | undefined,
  appearance: 'light' | 'dark'): ThemeId {
  const selected = themeChoices.find(theme => theme.id === config?.theme) ?? themeChoices[0];
  if (config?.themeMode !== 'system') return selected.id;
  const desired = config.systemThemePair?.[appearance];
  const fallback = themeChoices.find(theme => theme.appearance === appearance && theme.contrast === selected.contrast)
    ?? themeChoices.find(theme => theme.appearance === appearance);
  return themeChoices.find(theme => theme.id === desired && theme.appearance === appearance)?.id ?? fallback?.id ?? selected.id;
}

export function paletteFor(id: ThemeId) {
  const theme = themeChoices.find(candidate => candidate.id === id) ?? themeChoices[0];
  const c = theme.colors;
  return {
    bg: c.background, surface: c.header, content: c.content, sidebar: c.sidebar, input: c.input, elevated: c.elevated, border: c.border,
    borderStrong: c.borderStrong, hover: c.hover, text: c.text, disabledText: `${c.text}99`, muted: c.muted, hint: c.hint,
    accent: c.accent, accentSolid: c.accentSolid, accentHover: c.accentHover, onAccent: c.onAccent,
    primaryDisabledBg: `${c.accent}99`, primaryDisabledText: `${c.onAccent}99`,
    primarySubtle: `${c.accent}1a`, primaryMuted: `${c.accent}66`,
    bubbleUserBg: `${c.bubbleAccent}1a`, bubbleUserBorder: `${c.bubbleAccent}66`,
    sunken: theme.appearance === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.12)',
    dialogShadowOpacity: theme.appearance === 'light' ? 0.14 : 0.4,
    mediumShadowOpacity: theme.appearance === 'light' ? 0.12 : 0.35,
    blue: c.info, success: c.success, warning: c.warning, red: c.danger,
    selectedBg: theme.appearance === 'light' ? '#eaf4e5' : '#21301c',
    selectedNav: theme.appearance === 'light' ? '#e4f0df' : '#31452a',
    switchOff: c.borderStrong, errorBg: theme.appearance === 'light' ? '#ffe2e4' : '#4b2b2b',
  };
}

export type Palette = ReturnType<typeof paletteFor>;
export const darkColor: Palette = paletteFor('dark');
