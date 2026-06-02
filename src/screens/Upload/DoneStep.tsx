import { Link } from 'react-router-dom'

interface DoneStepProps {
  comicDTag: string
  onUploadAnother: () => void
}

export function DoneStep({ comicDTag, onUploadAnother }: DoneStepProps) {
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-2xl font-semibold text-zinc-100">Published!</h2>
      <p className="text-sm text-zinc-400">Your comic has been published to the Nostr network.</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          to={`/comic/${comicDTag}`}
          className="rounded-full bg-white px-6 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
        >
          View Comic
        </Link>
        <button
          type="button"
          onClick={onUploadAnother}
          className="rounded-full border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Upload Another
        </button>
      </div>
    </div>
  )
}
