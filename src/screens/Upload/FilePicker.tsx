import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FilePickerProps {
  accept: string
  onFile: (file: File) => void
  children: ReactNode
  /** Accessible name for the file input. */
  label: string
  className?: string
  disabled?: boolean
  /** Enables drag-and-drop onto the picker. */
  onDragStateChange?: (dragging: boolean) => void
}

/**
 * A styled file chooser. The input is visually hidden but stays focusable (unlike
 * `display: none`), so keyboard and screen-reader users can still pick a file.
 */
export function FilePicker({
  accept,
  onFile,
  children,
  label,
  className,
  disabled,
  onDragStateChange,
}: FilePickerProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onFile(file)
    // Allow choosing the same file again after an error.
    event.target.value = ''
  }

  const dragHandlers = onDragStateChange
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault()
          onDragStateChange(true)
        },
        onDragLeave: () => onDragStateChange(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault()
          onDragStateChange(false)
          const file = event.dataTransfer.files[0]
          if (file && !disabled) onFile(file)
        },
      }
    : {}

  return (
    <label
      {...dragHandlers}
      className={cn(
        'cursor-pointer outline-none transition has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      {children}
      <input
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        className="sr-only"
        onChange={handleChange}
      />
    </label>
  )
}
