import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import pt from './pt.json'
import es from './es.json'

const STORAGE_KEY = 'contentos_language'

const stored = localStorage.getItem(STORAGE_KEY)

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
    es: { translation: es },
  },
  lng: stored ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng)
})

export default i18n
