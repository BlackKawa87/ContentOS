export type Role = 'OWNER' | 'ADMIN' | 'USER'
export type Language = 'EN' | 'PT' | 'ES'
export type Theme = 'LIGHT' | 'DARK'

export interface Profile {
  id: string
  email: string
  displayName: string | null
  role: Role
  defaultLanguage: Language
  translationLang: Language
  defaultVoiceId: string | null
  theme: Theme
}
