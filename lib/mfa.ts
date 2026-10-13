import { query, queryOne } from './db'
import { decrypt, encrypt, generateTotpSecret } from './crypto'

/** Creates (once) the pending authenticator secret for the enrollment screen. */
export async function pendingTotpSecret(userId: string): Promise<string> {
  const row = await queryOne<{ totp_secret_enc: string | null; totp_enabled: boolean }>(
    'select totp_secret_enc, totp_enabled from users where id = $1',
    [userId],
  )
  if (row?.totp_secret_enc && !row.totp_enabled) return decrypt(row.totp_secret_enc)
  const secret = generateTotpSecret()
  await query('update users set totp_secret_enc = $2 where id = $1 and totp_enabled = false', [userId, encrypt(secret)])
  return secret
}
