import type { UploadArtifact } from './publishDraft'

export const BLOSSOM_UPLOAD_TIMEOUT_MS = 20000
export const BLOSSOM_UPLOAD_MAX_ATTEMPTS = 3
// Assume a slow mobile uplink so big pages aren't aborted mid-transfer.
const ASSUMED_UPLOAD_BYTES_PER_SEC = 64 * 1024

/** Per-request timeout that grows with file size (each upload makes a HEAD and a PUT). */
export function uploadTimeoutMs(sizeBytes: number): number {
  return BLOSSOM_UPLOAD_TIMEOUT_MS + Math.ceil(sizeBytes / ASSUMED_UPLOAD_BYTES_PER_SEC) * 1000
}

/** Auth, size/type rejections and similar will fail the same way again; don't retry them. */
export function isRetryableUploadError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500
  const message = err instanceof Error ? err.message : String(err)
  return !/authoriz|payment|auth handler/i.test(message)
}

export async function retryUpload<T>(
  attempt: (n: number) => Promise<T>,
  maxAttempts = BLOSSOM_UPLOAD_MAX_ATTEMPTS,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      return await attempt(n)
    } catch (err) {
      lastError = err
      if (n === maxAttempts || !isRetryableUploadError(err)) break
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (n - 1)))
    }
  }
  throw lastError
}

export async function uploadFileToServers(
  serverUrls: string[],
  upload: (serverUrl: string) => Promise<{ sha256: string; url: string }>,
  setCachedHash: (hash: string, objectUrl: string) => void,
): Promise<UploadArtifact> {
  type UploadAttemptResult = {
    serverUrl: string
    sha256: string
    url: string
  }

  const attempts = await Promise.allSettled(
    serverUrls.map(async (serverUrl) => {
      const result = await upload(serverUrl)
      setCachedHash(result.sha256, result.url)
      return {
        serverUrl,
        sha256: result.sha256,
        url: result.url,
      }
    }),
  )

  const successfulServers = attempts
    .filter((result): result is PromiseFulfilledResult<UploadAttemptResult> =>
      result.status === 'fulfilled',
    )
    .map((result) => result.value)
  const missingServers = attempts
    .map((result, index) => (result.status === 'rejected' ? serverUrls[index] : null))
    .filter((serverUrl): serverUrl is string => Boolean(serverUrl))

  if (successfulServers.length === 0) {
    throw new Error('Failed to upload to any Blossom server.')
  }

  return {
    hash: successfulServers[0].sha256,
    servers: successfulServers.map((result) => result.serverUrl),
    missingServers,
  }
}
