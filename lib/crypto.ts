import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto'

// ---------- Passwords (scrypt) ----------

const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, 64, SCRYPT_OPTS, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

// Used when the account doesn't exist so response timing doesn't reveal it.
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, saltB64, keyB64] = (stored ?? DUMMY_HASH).split('$')
  if (scheme !== 'scrypt') return false
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'))
  const expected = Buffer.from(keyB64, 'base64')
  return stored !== null && key.length === expected.length && timingSafeEqual(key, expected)
}

export function passwordProblem(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.'
  if (password.length > 200) return 'Password is too long.'
  return null
}

// ---------- Tokens & hashing ----------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ---------- Encryption at rest (AES-256-GCM) ----------

function encryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY must be set')
    return createHash('sha256').update('lunar-aerolabs-dev-only-key').digest()
  }
  return createHash('sha256').update(secret).digest()
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(payload: string): string {
  const [iv, tag, ct] = payload.split('.').map((s) => Buffer.from(s, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ---------- TOTP (RFC 6238, compatible with Google Authenticator) ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(str: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

const TOTP_PERIOD = 30

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = mac[mac.length - 1] & 0xf
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, '0')
}

/**
 * Returns the matched time step, or null. Accepts one step of clock drift and
 * rejects any step at or before `lastStep` so a code can't be replayed.
 */
export function verifyTotp(secret: string, code: string, lastStep: number): number | null {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD)
  for (const step of [now - 1, now, now + 1]) {
    if (step > lastStep && safeEqual(hotp(secret, step), clean)) return step
  }
  return null
}

export function totpUri(secret: string, email: string): string {
  const issuer = 'Lunar AeroLabs'
  const label = encodeURIComponent(`${issuer}:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 10)
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '')
}
