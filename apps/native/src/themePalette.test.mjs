import {expect, test} from 'bun:test';
import {deriveThemePair, paletteFor, resolveThemeId, themeChoices} from './themePalette.ts';

test('all bundled themes resolve and carry their original surface colors', () => {
  expect(themeChoices.map(theme => theme.id)).toEqual(['dark', 'light', 'high-contrast-dark', 'high-contrast-light']);
  expect(paletteFor('dark')).toMatchObject({bg: '#09090b', surface: '#18181b', accent: '#8dff4f'});
  expect(paletteFor('light')).toMatchObject({bg: '#ffffff', text: '#27272a', accent: '#2a7314'});
  expect(paletteFor('dark')).toMatchObject({bubbleUserBg: '#8dff4f1a', bubbleUserBorder: '#8dff4f66'});
  expect(paletteFor('high-contrast-light')).toMatchObject({bubbleUserBg: '#125c191a', bubbleUserBorder: '#125c1966'});
});

test('fixed and system modes choose the configured theme for this device', () => {
  expect(resolveThemeId({theme: 'light', themeMode: 'fixed'}, 'dark')).toBe('light');
  expect(deriveThemePair('high-contrast-dark')).toEqual({light: 'high-contrast-light', dark: 'high-contrast-dark'});
  const config = {theme: 'dark', themeMode: 'system', systemThemePair: {light: 'high-contrast-light', dark: 'dark'}};
  expect(resolveThemeId(config, 'light')).toBe('high-contrast-light');
  expect(resolveThemeId(config, 'dark')).toBe('dark');
  expect(resolveThemeId({...config, systemThemePair: {light: 'dark', dark: 'light'}}, 'light')).toBe('light');
});
