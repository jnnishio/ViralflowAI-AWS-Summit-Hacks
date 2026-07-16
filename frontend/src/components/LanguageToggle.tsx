import { LANGUAGE_LABELS, useI18n } from '../i18n'
import './LanguageToggle.css'

/**
 * Global floating language switch. Rendered once at the app root so it appears
 * on every page (Upload → Platforms → Processing → Highlights/Compilation).
 * A single pill with two segments; the inactive segment switches the language.
 */
export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      className="lang-toggle"
      role="group"
      aria-label={t('lang.toggleAria')}
    >
      <button
        type="button"
        className={`lang-toggle__opt${lang === 'zh-Hant' ? ' is-active' : ''}`}
        aria-pressed={lang === 'zh-Hant'}
        onClick={() => setLang('zh-Hant')}
      >
        {LANGUAGE_LABELS['zh-Hant']}
      </button>
      <button
        type="button"
        className={`lang-toggle__opt${lang === 'en' ? ' is-active' : ''}`}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        {LANGUAGE_LABELS.en}
      </button>
    </div>
  )
}

export default LanguageToggle
