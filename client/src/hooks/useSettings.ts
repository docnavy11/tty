import { useState, useEffect, useCallback } from 'react'
import type { ThemeName } from '../themes'

export interface AppSettings {
  fontSize: number
  fontFamily: string
  theme: ThemeName
}

const DEFAULTS: AppSettings = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  theme: 'dracula',
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)

  const load = useCallback(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((raw: Record<string, string>) => {
        setSettings({
          fontSize: Number(raw.fontSize) || DEFAULTS.fontSize,
          fontFamily: raw.fontFamily || DEFAULTS.fontFamily,
          theme: (raw.theme as ThemeName) || DEFAULTS.theme,
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  return { settings, reload: load }
}
