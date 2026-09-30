import {createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode} from 'react';
import {Appearance} from 'react-native';
import type {AppConfig} from './HostClient';
import {darkColor, paletteFor, resolveThemeId, type Palette, type ThemeId} from './themePalette';

let preference: Pick<AppConfig, 'theme' | 'themeMode' | 'systemThemePair'> | undefined;
let currentId: ThemeId = 'dark';
let currentPalette: Palette = darkColor;
const listeners = new Set<() => void>();
const stylesCache = new WeakMap<Function, Map<ThemeId, unknown>>();
const ThemeContext = createContext<ThemeId>('dark');
const subscribe = (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);};
const snapshot = () => currentId;

function applyAppearance() {
  const next = resolveThemeId(preference, Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
  if (next === currentId) return;
  currentId = next;
  currentPalette = paletteFor(next);
  listeners.forEach(listener => listener());
}

export function setThemePreference(config: AppConfig | undefined) {
  preference = config;
  applyAppearance();
}

export function observeSystemAppearance() {
  const subscription = Appearance.addChangeListener(applyAppearance);
  return () => subscription.remove();
}

export const color: Palette = new Proxy(darkColor, {get: (_, key: keyof Palette) => currentPalette[key]});

export function useThemeId() {
  return useSyncExternalStore(subscribe, snapshot);
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const id = useThemeId();
  useEffect(observeSystemAppearance, []);
  return createElement(ThemeContext.Provider, {value: id}, children);
}

export function useThemeStyles<T>(createStyles: (palette: Palette) => T): T {
  const id = useContext(ThemeContext);
  let variants = stylesCache.get(createStyles);
  if (!variants) {
    variants = new Map();
    stylesCache.set(createStyles, variants);
  }
  if (!variants.has(id)) variants.set(id, createStyles(paletteFor(id)));
  return variants.get(id) as T;
}
