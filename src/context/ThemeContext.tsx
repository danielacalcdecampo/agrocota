import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@agrocota:theme_mode';

type ThemeMode = 'light' | 'dark';

type ThemeContextData = {
  mode: ThemeMode;
  isDark: boolean;
  setDarkMode: (value: boolean) => Promise<void>;
  toggleMode: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextData>({} as ThemeContextData);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(saved => {
        if (saved === 'dark' || saved === 'light') {
          setMode(saved);
        }
      })
      .catch(() => {
      });
  }, []);

  const setDarkMode = useCallback(async (value: boolean) => {
    const nextMode: ThemeMode = value ? 'dark' : 'light';
    setMode(nextMode);
    await AsyncStorage.setItem(STORAGE_KEY, nextMode);
  }, []);

  const toggleMode = useCallback(async () => {
    const nextMode: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(nextMode);
    await AsyncStorage.setItem(STORAGE_KEY, nextMode);
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      isDark: mode === 'dark',
      setDarkMode,
      toggleMode,
    }),
    [mode, setDarkMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useThemeMode = () => useContext(ThemeContext);
