import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUser, HttpError } from '../../server/lib/auth'
import { prisma } from '../../server/lib/prisma'
import { encryptSecret } from '../../server/lib/encryption'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req)

    if (req.method === 'GET') {
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { id: user.id },
        select: { openaiApiKeyEnc: true, elevenlabsApiKeyEnc: true },
      })
      return res.status(200).json({
        openaiKeySet: profile.openaiApiKeyEnc !== null,
        elevenlabsKeySet: profile.elevenlabsApiKeyEnc !== null,
      })
    }

    if (req.method === 'PUT') {
      const { openaiApiKey, elevenlabsApiKey } = req.body ?? {}

      const data: { openaiApiKeyEnc?: Uint8Array<ArrayBuffer>; elevenlabsApiKeyEnc?: Uint8Array<ArrayBuffer> } = {}
      if (typeof openaiApiKey === 'string' && openaiApiKey.length > 0) {
        data.openaiApiKeyEnc = new Uint8Array(await encryptSecret(openaiApiKey)) as Uint8Array<ArrayBuffer>
      }
      if (typeof elevenlabsApiKey === 'string' && elevenlabsApiKey.length > 0) {
        data.elevenlabsApiKeyEnc = new Uint8Array(await encryptSecret(elevenlabsApiKey)) as Uint8Array<ArrayBuffer>
      }

      await prisma.profile.update({ where: { id: user.id }, data })
      return res.status(200).json({ ok: true })
    }

    res.setHeader('Allow', 'GET, PUT')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
