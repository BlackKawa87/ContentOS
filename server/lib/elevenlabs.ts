import { ElevenLabsClient } from 'elevenlabs'
import { prisma } from './prisma.ts'
import { decryptSecret } from './encryption.ts'

/** Resolves the ElevenLabs client to use for a given profile: their own key if set, else the platform default. */
export async function getElevenLabsClientForProfile(profileId: string): Promise<ElevenLabsClient> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { elevenlabsApiKeyEnc: true },
  })

  const apiKey = profile.elevenlabsApiKeyEnc
    ? await decryptSecret(Buffer.from(profile.elevenlabsApiKeyEnc))
    : process.env.ELEVENLABS_API_KEY

  if (!apiKey) throw new Error('No ElevenLabs API key configured (neither user nor platform default)')
  return new ElevenLabsClient({ apiKey })
}

/** A widely available multilingual default voice (Rachel). Overridden by profile.defaultVoiceId when set. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'
