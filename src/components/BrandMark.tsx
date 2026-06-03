import logoUrl from '@/assets/mangatsu.webp'

type BrandMarkSize = 'sm' | 'md' | 'lg'

interface BrandMarkProps {
  size?: BrandMarkSize
  showLabel?: boolean
  className?: string
}

const sizeClasses: Record<BrandMarkSize, string> = {
  sm: 'h-10 w-10',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
}

const labelClasses: Record<BrandMarkSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
}

export function BrandMark({ size = 'md', showLabel = true, className = '' }: BrandMarkProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <div
        className={`${sizeClasses[size]} shrink-0 overflow-hidden rounded-full bg-zinc-950/40 ring-1 ring-white/10 drop-shadow-[0_18px_24px_rgba(0,0,0,0.45)]`}
      >
        <img
          src={logoUrl}
          alt="Mangatsu"
          className="h-full w-full object-cover"
        />
      </div>
      {showLabel ? (
        <div className="leading-none">
          <p className={`font-semibold tracking-[0.32em] text-zinc-100 ${labelClasses[size]}`}>
            MANGATSU
          </p>
          <p className="mt-2 text-[0.65rem] uppercase tracking-[0.45em] text-zinc-500">
            Manga library for Nostr
          </p>
        </div>
      ) : null}
    </div>
  )
}
