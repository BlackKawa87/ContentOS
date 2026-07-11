import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'

interface KeyStatus {
  openaiKeySet: boolean
  elevenlabsKeySet: boolean
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
  })
}

export default function Settings() {
  const { t } = useTranslation()
  const { profile, refreshProfile } = useAuth()

  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [elevenlabsApiKey, setElevenlabsApiKey] = useState('')
  const [defaultVoiceId, setDefaultVoiceId] = useState(profile?.defaultVoiceId ?? '')
  const [defaultLanguage, setDefaultLanguage] = useState(profile?.defaultLanguage ?? 'EN')
  const [translationLang, setTranslationLang] = useState(profile?.translationLang ?? 'PT')
  const [reverseDefaultImportLimit, setReverseDefaultImportLimit] = useState(
    profile?.reverseDefaultImportLimit ?? 25,
  )
  const [reverseMaxVideos, setReverseMaxVideos] = useState(profile?.reverseMaxVideos ?? 100)
  const [reverseMaxPlaylists, setReverseMaxPlaylists] = useState(profile?.reverseMaxPlaylists ?? 10)
  const [outlierAboveAvgMultiplier, setOutlierAboveAvgMultiplier] = useState(
    profile?.outlierAboveAvgMultiplier ?? 2,
  )
  const [outlierStrongMultiplier, setOutlierStrongMultiplier] = useState(
    profile?.outlierStrongMultiplier ?? 5,
  )
  const [outlierViralMultiplier, setOutlierViralMultiplier] = useState(
    profile?.outlierViralMultiplier ?? 10,
  )
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    authedFetch('/api/settings/keys')
      .then((r) => r.json())
      .then(setKeyStatus)
      .catch(() => setKeyStatus(null))
  }, [])

  useEffect(() => {
    if (!profile) return
    setDefaultVoiceId(profile.defaultVoiceId ?? '')
    setDefaultLanguage(profile.defaultLanguage)
    setTranslationLang(profile.translationLang)
    setReverseDefaultImportLimit(profile.reverseDefaultImportLimit)
    setReverseMaxVideos(profile.reverseMaxVideos)
    setReverseMaxPlaylists(profile.reverseMaxPlaylists)
    setOutlierAboveAvgMultiplier(profile.outlierAboveAvgMultiplier)
    setOutlierStrongMultiplier(profile.outlierStrongMultiplier)
    setOutlierViralMultiplier(profile.outlierViralMultiplier)
  }, [profile])

  async function handleSaveKeys(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSavedMessage(null)
    await authedFetch('/api/settings/keys', {
      method: 'PUT',
      body: JSON.stringify({ openaiApiKey, elevenlabsApiKey }),
    })
    setOpenaiApiKey('')
    setElevenlabsApiKey('')
    const status = await (await authedFetch('/api/settings/keys')).json()
    setKeyStatus(status)
    setSaving(false)
    setSavedMessage(t('settings.save'))
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSavedMessage(null)
    await authedFetch('/api/settings/profile', {
      method: 'PUT',
      body: JSON.stringify({ defaultVoiceId, defaultLanguage, translationLang }),
    })
    await refreshProfile()
    setSaving(false)
    setSavedMessage(t('settings.save'))
  }

  async function handleSaveReverseSettings(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSavedMessage(null)
    await authedFetch('/api/settings/profile', {
      method: 'PUT',
      body: JSON.stringify({
        reverseDefaultImportLimit,
        reverseMaxVideos,
        reverseMaxPlaylists,
        outlierAboveAvgMultiplier,
        outlierStrongMultiplier,
        outlierViralMultiplier,
      }),
    })
    await refreshProfile()
    setSaving(false)
    setSavedMessage(t('settings.save'))
  }

  const inputClass =
    'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'
  const labelClass = 'flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300'

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t('settings.title')}
      </h1>

      <form
        onSubmit={handleSaveKeys}
        className="mb-8 flex flex-col gap-4 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t('settings.apiKeys')}
        </h2>

        <label className={labelClass}>
          {t('settings.openaiKey')}{' '}
          {keyStatus?.openaiKeySet && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">configured</span>
          )}
          <input
            type="password"
            placeholder="sk-..."
            value={openaiApiKey}
            onChange={(e) => setOpenaiApiKey(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.elevenlabsKey')}{' '}
          {keyStatus?.elevenlabsKeySet && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">configured</span>
          )}
          <input
            type="password"
            placeholder="sk_..."
            value={elevenlabsApiKey}
            onChange={(e) => setElevenlabsApiKey(e.target.value)}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t('settings.save')}
        </button>
      </form>

      <form
        onSubmit={handleSaveProfile}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t('nav.studyEngine')}
        </h2>

        <label className={labelClass}>
          {t('settings.defaultVoice')}
          <input
            type="text"
            placeholder="ElevenLabs voice id"
            value={defaultVoiceId}
            onChange={(e) => setDefaultVoiceId(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.defaultLanguage')}
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value as typeof defaultLanguage)}
            className={inputClass}
          >
            <option value="EN">English</option>
            <option value="PT">Português</option>
            <option value="ES">Español</option>
          </select>
        </label>

        <label className={labelClass}>
          {t('settings.translationLanguage')}
          <select
            value={translationLang}
            onChange={(e) => setTranslationLang(e.target.value as typeof translationLang)}
            className={inputClass}
          >
            <option value="EN">English</option>
            <option value="PT">Português</option>
            <option value="ES">Español</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t('settings.save')}
        </button>
      </form>

      <form
        onSubmit={handleSaveReverseSettings}
        className="mt-8 flex flex-col gap-4 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
      >
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {t('nav.reverseEngineering')}
        </h2>

        <label className={labelClass}>
          {t('settings.reverseDefaultImportLimit')}
          <input
            type="number"
            min={1}
            value={reverseDefaultImportLimit}
            onChange={(e) => setReverseDefaultImportLimit(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.reverseMaxVideos')}
          <input
            type="number"
            min={1}
            value={reverseMaxVideos}
            onChange={(e) => setReverseMaxVideos(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.reverseMaxPlaylists')}
          <input
            type="number"
            min={1}
            value={reverseMaxPlaylists}
            onChange={(e) => setReverseMaxPlaylists(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.outlierAboveAvg')}
          <input
            type="number"
            min={1}
            step={0.5}
            value={outlierAboveAvgMultiplier}
            onChange={(e) => setOutlierAboveAvgMultiplier(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.outlierStrong')}
          <input
            type="number"
            min={1}
            step={0.5}
            value={outlierStrongMultiplier}
            onChange={(e) => setOutlierStrongMultiplier(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          {t('settings.outlierViral')}
          <input
            type="number"
            min={1}
            step={0.5}
            value={outlierViralMultiplier}
            onChange={(e) => setOutlierViralMultiplier(Number(e.target.value))}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t('settings.save')}
        </button>
      </form>

      {savedMessage && (
        <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{savedMessage}</p>
      )}
    </div>
  )
}
