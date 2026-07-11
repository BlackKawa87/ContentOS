import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth.js'
import { prisma } from '../../server/lib/prisma.js'

const LANGUAGES = ['EN', 'PT', 'ES'] as const
const THEMES = ['LIGHT', 'DARK'] as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method !== 'PUT') {
      res.setHeader('Allow', 'PUT')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const {
      displayName,
      defaultLanguage,
      translationLang,
      defaultVoiceId,
      theme,
      reverseDefaultImportLimit,
      reverseMaxVideos,
      reverseMaxPlaylists,
      outlierAboveAvgMultiplier,
      outlierStrongMultiplier,
      outlierViralMultiplier,
    } = req.body ?? {}

    const data: Record<string, unknown> = {}
    if (typeof displayName === 'string') data.displayName = displayName
    if (LANGUAGES.includes(defaultLanguage)) data.defaultLanguage = defaultLanguage
    if (LANGUAGES.includes(translationLang)) data.translationLang = translationLang
    if (typeof defaultVoiceId === 'string') data.defaultVoiceId = defaultVoiceId
    if (THEMES.includes(theme)) data.theme = theme
    if (Number.isFinite(reverseDefaultImportLimit) && reverseDefaultImportLimit > 0)
      data.reverseDefaultImportLimit = Math.trunc(reverseDefaultImportLimit)
    if (Number.isFinite(reverseMaxVideos) && reverseMaxVideos > 0)
      data.reverseMaxVideos = Math.trunc(reverseMaxVideos)
    if (Number.isFinite(reverseMaxPlaylists) && reverseMaxPlaylists > 0)
      data.reverseMaxPlaylists = Math.trunc(reverseMaxPlaylists)
    if (Number.isFinite(outlierAboveAvgMultiplier) && outlierAboveAvgMultiplier > 0)
      data.outlierAboveAvgMultiplier = outlierAboveAvgMultiplier
    if (Number.isFinite(outlierStrongMultiplier) && outlierStrongMultiplier > 0)
      data.outlierStrongMultiplier = outlierStrongMultiplier
    if (Number.isFinite(outlierViralMultiplier) && outlierViralMultiplier > 0)
      data.outlierViralMultiplier = outlierViralMultiplier

    const profile = await prisma.profile.update({ where: { id: user.id }, data })
    return res.status(200).json({ profile })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
