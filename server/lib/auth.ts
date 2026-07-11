import type { VercelRequest } from '@vercel/node'
import { prisma } from './prisma.js'

export interface AuthedUser {
  id: string
  email: string
}

let cachedUser: AuthedUser | null = null

/** Single-user personal deployment — no login. Every request acts as the one existing
 * profile rather than verifying a Supabase session/Bearer token. Kept as an async function
 * with this signature (unchanged from the old JWT-checking version) so none of the API
 * route call sites needed to change. */
export async function requireUser(_req: VercelRequest): Promise<AuthedUser> {
  if (cachedUser) return cachedUser
  const profile = await prisma.profile.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })
  cachedUser = { id: profile.id, email: profile.email }
  return cachedUser
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
