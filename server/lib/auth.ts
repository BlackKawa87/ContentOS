import type { VercelRequest } from '@vercel/node'
import { supabaseAdmin } from './supabaseAdmin.js'

export interface AuthedUser {
  id: string
  email: string
}

/** Verifies the Supabase access token from the Authorization header. Throws on failure. */
export async function requireUser(req: VercelRequest): Promise<AuthedUser> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!token) throw new HttpError(401, 'Missing bearer token')

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired token')

  return { id: data.user.id, email: data.user.email ?? '' }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
