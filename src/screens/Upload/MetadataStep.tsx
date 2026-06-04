import { AuthorPubkeyInput } from './AuthorPubkeyInput'

export interface MetadataFormValues {
  title: string
  authorName: string
  authorPubkey: string
  authorDisplayName: string
  description: string
  tags: string          // comma-separated raw input
  language: string
  coverFile: File | null
  coverMode: 'file' | 'first-page'
}

interface MetadataStepProps {
  values: MetadataFormValues
  onChange: (values: MetadataFormValues) => void
  onNext: () => void
  allowFirstPage?: boolean
}

function inputClass(extra = '') {
  return `w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none ${extra}`
}

export function MetadataStep({ values, onChange, onNext, allowFirstPage = true }: MetadataStepProps) {
  function set<K extends keyof MetadataFormValues>(key: K, val: MetadataFormValues[K]) {
    onChange({ ...values, [key]: val })
  }

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    onChange({ ...values, coverFile: file, coverMode: file ? 'file' : values.coverMode })
  }

  const canProceed = values.title.trim().length > 0

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Step 1 — Comic Details</h2>

      <div className="space-y-1">
        <label className="text-sm text-zinc-400">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          placeholder="My Amazing Manga"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          className={inputClass()}
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Author Name</label>
        <input
          type="text"
          placeholder="Author display name"
          value={values.authorName}
          onChange={(e) => set('authorName', e.target.value)}
          className={inputClass()}
        />
      </div>

      <AuthorPubkeyInput
        value={values.authorPubkey}
        onChange={(hex, displayName) =>
          onChange({ ...values, authorPubkey: hex, authorDisplayName: displayName })
        }
      />

      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Description</label>
        <textarea
          placeholder="Brief description of the comic..."
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          className={inputClass('resize-none')}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Tags (comma-separated)</label>
        <input
          type="text"
          placeholder="action, adventure, fantasy"
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
          className={inputClass()}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-zinc-400">Language</label>
        <input
          type="text"
          placeholder="en"
          value={values.language}
          onChange={(e) => set('language', e.target.value)}
          className={inputClass('max-w-[8rem]')}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm text-zinc-400">Cover Image</label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="cursor-pointer rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
            {values.coverFile ? values.coverFile.name : 'Choose JPG/PNG/WebP...'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverFile}
            />
          </label>
          {allowFirstPage ? (
            <>
              <span className="text-xs text-zinc-600">or</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={values.coverMode === 'first-page'}
                  onChange={(e) =>
                    set('coverMode', e.target.checked ? 'first-page' : 'file')
                  }
                  className="accent-zinc-400"
                />
                Use first page of CBZ
              </label>
            </>
          ) : null}
        </div>
        {values.coverFile && values.coverMode === 'file' && (
          <img
            src={URL.createObjectURL(values.coverFile)}
            alt="Cover preview"
            className="h-24 w-auto rounded-lg object-cover"
          />
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!canProceed}
        className="w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next: Add Chapter
      </button>
    </div>
  )
}
