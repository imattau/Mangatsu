const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256

let sessionKey: CryptoKey | null = null

export async function initSession(): Promise<void> {
  sessionKey = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptForSession(plaintext: string): Promise<string> {
  if (!sessionKey) {
    throw new Error('Session key not initialized')
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    sessionKey,
    encoded,
  )
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCodePoint(...combined))
}

export async function decryptFromSession(encoded: string): Promise<string | null> {
  if (!sessionKey) return null

  try {
    const combined = Uint8Array.from(atob(encoded), (c) => c.codePointAt(0)!)
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      sessionKey,
      ciphertext,
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

export function hasSessionKey(): boolean {
  return sessionKey !== null
}

export function clearSession(): void {
  sessionKey = null
}
