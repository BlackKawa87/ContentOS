import { prisma } from './prisma'

const key = process.env.SETTINGS_ENCRYPTION_KEY
if (!key) throw new Error('SETTINGS_ENCRYPTION_KEY must be set')

/** Encrypts a secret with pgcrypto (pgp_sym_encrypt) and returns the ciphertext bytes. */
export async function encryptSecret(plaintext: string): Promise<Buffer> {
  const rows = await prisma.$queryRaw<{ enc: Buffer }[]>`
    select pgp_sym_encrypt(${plaintext}, ${key}) as enc
  `
  return rows[0].enc
}

/** Decrypts a pgp_sym_encrypt-produced buffer back to plaintext. */
export async function decryptSecret(ciphertext: Buffer): Promise<string> {
  const rows = await prisma.$queryRaw<{ dec: string }[]>`
    select pgp_sym_decrypt(${ciphertext}, ${key}) as dec
  `
  return rows[0].dec
}
