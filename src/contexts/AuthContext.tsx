import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../types/profile'

interface AuthContextValue {
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PROFILE_COLUMNS =
  'id, email, displayName, role, defaultLanguage, translationLang, defaultVoiceId, theme, reverseDefaultImportLimit, reverseMaxVideos, reverseMaxPlaylists, outlierAboveAvgMultiplier, outlierStrongMultiplier, outlierViralMultiplier'

/** Single-user personal deployment — no login. Always loads the one existing profile
 * rather than gating on a Supabase session (RLS is disabled to match, see policies.sql). */
async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('createdAt', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to load profile', error)
    return null
  }
  return data as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshProfile() {
    const p = await fetchProfile()
    setProfile(p)
  }

  useEffect(() => {
    refreshProfile().finally(() => setLoading(false))
  }, [])

  return <AuthContext.Provider value={{ profile, loading, refreshProfile }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
