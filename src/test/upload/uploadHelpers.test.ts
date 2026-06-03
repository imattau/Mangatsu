import { describe, expect, it, vi } from 'vitest'
import { uploadFileToServers } from '@/screens/Upload/uploadHelpers'

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
    })
    expect(setCachedHash).toHaveBeenCalledTimes(2)
  })
})
