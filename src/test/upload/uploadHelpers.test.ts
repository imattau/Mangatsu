import { describe, expect, it, vi } from 'vitest'
import { isRetryableUploadError, retryUpload, uploadFileToServers, uploadTimeoutMs } from '@/screens/Upload/uploadHelpers'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('uploadFileToServers', () => {
  it('starts all server uploads without waiting for the first one to finish', async () => {
    const first = deferred<{ sha256: string; url: string }>()
    const second = deferred<{ sha256: string; url: string }>()
    const started: string[] = []
    const upload = vi.fn(async (serverUrl: string) => {
      started.push(serverUrl)
      if (serverUrl === 'https://a.example') return first.promise
      return second.promise
    })
    const setCachedHash = vi.fn()

    const resultPromise = uploadFileToServers(
      ['https://a.example', 'https://b.example'],
      upload,
      setCachedHash,
    )

    expect(upload).toHaveBeenCalledTimes(2)
    expect(started).toEqual(['https://a.example', 'https://b.example'])

    first.resolve({ sha256: 'hash', url: 'https://a.example/hash' })
    second.resolve({ sha256: 'hash', url: 'https://b.example/hash' })

    await expect(resultPromise).resolves.toEqual({
      hash: 'hash',
      servers: ['https://a.example', 'https://b.example'],
      missingServers: [],
    })
    expect(setCachedHash).toHaveBeenCalledTimes(2)
  })
})

describe('retryUpload', () => {
  it('retries transient failures then succeeds', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error('Server error')).mockResolvedValueOnce('ok')
    await expect(retryUpload(attempt, 3, 0)).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not retry client errors', async () => {
    const attempt = vi.fn().mockRejectedValue(Object.assign(new Error('too big'), { status: 413 }))
    await expect(retryUpload(attempt, 3, 0)).rejects.toThrow('too big')
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(isRetryableUploadError(Object.assign(new Error('x'), { status: 503 }))).toBe(true)
  })

  it('scales the timeout with file size', () => {
    expect(uploadTimeoutMs(10 * 1024 * 1024)).toBeGreaterThan(uploadTimeoutMs(1024))
  })
})
