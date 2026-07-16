import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  TRANSLATIONS,
  type Language,
  type TranslationKey,
} from './translations'

const STORAGE_KEY = 'viralflow.lang'

/** Values passed to `t` for `{placeholder}` interpolation. */
export type TranslationParams = Record<string, string | number>

export interface I18nContextValue {
  lang: Language
  setLang: (lang: Language) => void
  toggleLang: () => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as string[]).includes(value)
}

/** Read the persisted language, defaulting to Traditional Chinese. */
function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // localStorage may be unavailable (private mode, SSR); fall back silently.
  }
  return DEFAULT_LANGUAGE
}

/** Replace `{name}` placeholders in a template with provided params. */
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  )
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readStoredLanguage)

  const setLang = useCallback((next: Language) => {
    setLangState(next)
  }, [])

  const toggleLang = useCallback(() => {
    setLangState((current) => (current === 'zh-Hant' ? 'en' : 'zh-Hant'))
  }, [])

  // Persist the choice and reflect it on <html lang> for a11y / correct
  // font shaping.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // Ignore persistence failures.
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang
    }
  }, [lang])

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => {
      const table = TRANSLATIONS[lang] ?? TRANSLATIONS[DEFAULT_LANGUAGE]
      const template = table[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key
      return interpolate(template, params)
    },
    [lang],
  )

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, toggleLang, t }),
    [lang, setLang, toggleLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Access the current language, setters, and the `t` translator. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within a LanguageProvider')
  }
  return ctx
}
