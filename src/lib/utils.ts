import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/$/, '')
  }
}

export function resolveBlossomImageUrl(
  hash: string,
  server: string | undefined,
  cachedUrl?: string,
): string | null {
  if (!hash || !server) return null

  if (cachedUrl) {
    const serverOrigin = normalizeOrigin(server)
    const cachedOrigin = normalizeOrigin(cachedUrl)
    if (cachedOrigin === serverOrigin) {
      return cachedUrl
    }
  }

  return `${server.replace(/\/$/, '')}/${hash}`
}
