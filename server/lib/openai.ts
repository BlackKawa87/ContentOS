import OpenAI from 'openai'
import { prisma } from './prisma.js'
import { decryptSecret } from './encryption.js'

/** Resolves the OpenAI client to use for a given profile: their own key if set, else the platform default. */
export async function getOpenAiClientForProfile(profileId: string): Promise<OpenAI> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    select: { openaiApiKeyEnc: true },
  })

  const apiKey = profile.openaiApiKeyEnc
    ? await decryptSecret(Buffer.from(profile.openaiApiKeyEnc))
    : process.env.OPENAI_API_KEY

  if (!apiKey) throw new Error('No OpenAI API key configured (neither user nor platform default)')
  return new OpenAI({ apiKey })
}
