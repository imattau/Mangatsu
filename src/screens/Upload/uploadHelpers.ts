import type { UploadArtifact } from './publishDraft'

export const BLOSSOM_UPLOAD_TIMEOUT_MS = 20000

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`Timed out ${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
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
