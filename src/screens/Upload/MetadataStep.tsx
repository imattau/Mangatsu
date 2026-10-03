import { useEffect, useId, useMemo } from 'react'
import { ImagePlus } from 'lucide-react'
import { AuthorPubkeyInput } from './AuthorPubkeyInput'
import { FilePicker } from './FilePicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

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
  nsfw: boolean
}

interface MetadataStepProps {
  values: MetadataFormValues
  onChange: (values: MetadataFormValues) => void
  onNext: () => void
  allowFirstPage?: boolean
}

export function MetadataStep({ values, onChange, onNext, allowFirstPage = true }: MetadataStepProps) {
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`

  function set<K extends keyof MetadataFormValues>(key: K, val: MetadataFormValues[K]) {
    onChange({ ...values, [key]: val })
  }

  function handleCoverFile(file: File) {
    onChange({ ...values, coverFile: file, coverMode: 'file' })
  }

  // One object URL per chosen file (not per render), released when the file changes.
  const coverPreviewUrl = useMemo(
    () => (values.coverFile ? URL.createObjectURL(values.coverFile) : null),
    [values.coverFile],
  )
  useEffect(
    () => () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl)
    },
    [coverPreviewUrl],
  )

  const canProceed = values.title.trim().length > 0

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (canProceed) onNext()
      }}
    >
      <h2 className="text-lg font-semibold">Comic Details</h2>

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('title')}>
          Title <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <Input
          id={fieldId('title')}
          type="text"
          placeholder="My Amazing Manga"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('author')}>Author Name</Label>
        <Input
          id={fieldId('author')}
          type="text"
          placeholder="Author display name"
          value={values.authorName}
          onChange={(e) => set('authorName', e.target.value)}
        />
      </div>

      <AuthorPubkeyInput
        value={values.authorPubkey}
        onChange={(hex, displayName) =>
          onChange({ ...values, authorPubkey: hex, authorDisplayName: displayName })
        }
      />

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('description')}>Description</Label>
        <Textarea
          id={fieldId('description')}
          placeholder="Brief description of the comic..."
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          className="resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('tags')}>Tags (comma-separated)</Label>
        <Input
          id={fieldId('tags')}
          type="text"
          placeholder="action, adventure, fantasy"
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor={fieldId('nsfw')}>Mark as NSFW</Label>
          <p id={fieldId('nsfw-description')} className="mt-0.5 text-xs text-muted-foreground">
            Adds a content warning
          </p>
        </div>
        <Switch
          id={fieldId('nsfw')}
          checked={values.nsfw}
          onCheckedChange={(checked) => set('nsfw', checked)}
          aria-describedby={fieldId('nsfw-description')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={fieldId('language')}>Language</Label>
        <Input
          id={fieldId('language')}
          type="text"
          placeholder="en"
          value={values.language}
          onChange={(e) => set('language', e.target.value)}
          className="max-w-32"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Cover Image</legend>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <FilePicker
            accept="image/jpeg,image/png,image/webp"
            label="Choose cover image"
            onFile={handleCoverFile}
            className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-ring hover:text-foreground"
          >
            <ImagePlus aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{values.coverFile ? values.coverFile.name : 'Choose JPG/PNG/WebP...'}</span>
          </FilePicker>
          {allowFirstPage ? (
            <>
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={fieldId('first-page')}
                  checked={values.coverMode === 'first-page'}
                  onCheckedChange={(checked) => set('coverMode', checked === true ? 'first-page' : 'file')}
                />
                <Label htmlFor={fieldId('first-page')} className="font-normal text-muted-foreground">
                  Use first page of the chapter
                </Label>
              </div>
            </>
          ) : null}
        </div>
        {coverPreviewUrl && values.coverMode === 'file' && (
          <img
            src={coverPreviewUrl}
            alt="Cover preview"
            className="h-24 w-auto rounded-lg object-cover"
          />
        )}
      </fieldset>

      <Button type="submit" size="lg" disabled={!canProceed} className="h-11 w-full rounded-full">
        {allowFirstPage ? 'Next: Add Chapter' : 'Next: Upload'}
      </Button>
    </form>
  )
}
