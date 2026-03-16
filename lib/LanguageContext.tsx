import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { translations, type Lang, type TranslationKey } from './i18n'

const LANG_KEY = '@app_language'

type LanguageCtx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'hr',
  setLang: () => {},
  t: (key) => translations.hr[key] ?? key,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('hr')

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then(v => {
      if (v === 'hr' || v === 'en') setLangState(v)
    })
  }, [])

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l)
    await AsyncStorage.setItem(LANG_KEY, l)
  }, [])

  const t = useCallback(
    (key: TranslationKey): string => translations[lang][key] ?? translations.hr[key] ?? key,
    [lang],
  )

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
