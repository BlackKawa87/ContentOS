import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { t } = useTranslation()
  const { signInWithPassword, signUp } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const action = mode === 'signIn' ? signInWithPassword : signUp
    const { error: authError } = await action(email, password)

    setSubmitting(false)
    if (authError) {
      setError(authError)
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {t('app.name')}
        </h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300">
            {t('auth.email')}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300">
            {t('auth.password')}
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
          className="mt-4 text-sm text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
        >
          {mode === 'signIn' ? t('auth.noAccount') : t('auth.hasAccount')}
        </button>
      </div>
    </div>
  )
}
