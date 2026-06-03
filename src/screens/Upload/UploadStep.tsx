import { useEffect, useRef, useState } from 'react'
import { blossomService } from '@/services/BlossomService'
import { DEFAULT_BLOSSOM_SERVERS, useBlossomStore } from '@/stores/blossomStore'
import { useNostr } from '@/context/NostrContext'
import { convertImageFileToWebp } from './webp'
import type { UploadArtifact } from './publishDraft'

export interface UploadResult {
  pageUploads: UploadArtifact[]
  coverUpload: UploadArtifact | null
}

interface UploadStepProps {
  pages: File[]
  coverFile: File | null
  coverMode: 'file' | 'first-page'
  onDone: (result: UploadResult) => void
  onBack: () => void
}

export function UploadStep({ pages, coverFile, coverMode, onDone, onBack }: UploadStepProps) {
  const servers = useBlossomStore((s) => s.servers)
  const setCachedHash = useBlossomStore((s) => s.setCachedHash)
  const { service } = useNostr()
  const [uploaded, setUploaded] = useState(0)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'converting' | 'uploading'>('idle')
  const ranRef = useRef(false)

  const total = pages.length + (coverFile || coverMode === 'first-page' ? 1 : 0)

  function getUploadServers(): string[] {
    const ordered = [
      ...servers.map((server) => server.url),
      ...DEFAULT_BLOSSOM_SERVERS,
    ]
    return [...new Set(ordered.filter((server) => server.trim().length > 0))]
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadWithRetry(file: File, serverUrls: string[]): Promise<UploadArtifact> {
    const account = service.accountManager.active
    if (!account) throw new Error('Not logged in')

    const failures: string[] = []
    for (const serverUrl of serverUrls) {
      try {
        const result = await blossomService.upload(file, serverUrl, account.signer as never)
        setCachedHash(result.sha256, result.url)
        return { hash: result.sha256, server: serverUrl }
      } catch (err) {
        failures.push(`${serverUrl}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    throw new Error(`Failed to upload to any Blossom server.\n${failures.join('\n')}`)
  }

  async function convertAndUploadWithRetry(file: File, serverUrls: string[]): Promise<UploadArtifact> {
    setPhase('converting')
    const webpFile = await convertImageFileToWebp(file)
    setPhase('uploading')
    return uploadWithRetry(webpFile, serverUrls)
  }

  async function run() {
    setRunning(true)
    setError('')
    setPhase('idle')
    const serverUrls = getUploadServers()
    const pageUploads: UploadArtifact[] = []

    for (const page of pages) {
      try {
        const upload = await convertAndUploadWithRetry(page, serverUrls)
        pageUploads.push(upload)
        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload page: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        setPhase('idle')
        return
      }
    }

    let coverUpload: UploadArtifact | null = null
    const coverSource = coverMode === 'first-page' ? pages[0] : coverFile
    if (coverSource) {
      try {
        coverUpload = await convertAndUploadWithRetry(coverSource, serverUrls)
        setUploaded((n) => n + 1)
      } catch (err) {
        setError(`Failed to upload cover: ${err instanceof Error ? err.message : String(err)}`)
        setRunning(false)
        setPhase('idle')
        return
      }
    }

    setRunning(false)
    setPhase('idle')
    onDone({ pageUploads, coverUpload })
  }

  const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Step 3 — Uploading</h2>

      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-400">
          <span>
            {running
              ? phase === 'converting'
                ? `Converting ${uploaded + 1} of ${total}...`
                : `Uploading ${uploaded + 1} of ${total}...`
              : uploaded === total
              ? 'Upload complete'
              : 'Ready'}
          </span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => { ranRef.current = false; void run() }}
              className="flex-1 rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
