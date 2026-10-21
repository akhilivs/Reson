import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { applyPreferences, onSystemMotionChange } from '../services/themeService.js';
import { toastBus } from './toastBus.js';

const SettingsContext = createContext(null);

export function SettingsProvider({ initial, children }) {
  const [settings, setSettings] = useState(initial);

  useEffect(() => applyPreferences(settings), [settings]);
  useEffect(() => onSystemMotionChange(() => applyPreferences(settings)), [settings]);
  useEffect(
    () =>
      api.settings.onChanged(({ key, value }) => {
        setSettings((s) => (s[key] === value ? s : { ...s, [key]: value }));
      }),
    [],
  );

  const update = useCallback(async (key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      const saved = await api.settings.set(key, value);
      setSettings((s) => ({ ...s, [key]: saved }));
    } catch (err) {
      toastBus.push({ type: 'error', title: 'Setting not saved', message: err.message });
      const fresh = await api.settings.get().catch(() => null);
      if (fresh) setSettings(fresh);
    }
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
