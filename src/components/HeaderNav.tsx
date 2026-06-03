import { Link, useLocation } from 'react-router-dom'
import { useNostr } from '@/context/NostrContext'

const LibraryIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    <path d="M4 19V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13" />
    <path d="M4 19h16" />
    <path d="M9 7h6M9 11h6M9 15h4" />
  </svg>
)

const FeedIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0"
  >
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
)

const RefreshIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-4 w-4 shrink-0 ${className}`.trim()}
  >
    <path d="M20 11a8 8 0 1 0 2 5.3" />
    <path d="M20 5v6h-6" />
  </svg>
)

const TABS = [
  { label: 'Library', href: '/', Icon: LibraryIcon },
  { label: 'Feed', href: '/feed', Icon: FeedIcon },
]

export function HeaderNav() {
  const { pathname } = useLocation()
  const { refreshSync, isRefreshing } = useNostr()

  return (
    <nav className="flex items-center gap-1">
      <button
        type="button"
        onClick={refreshSync}
        disabled={isRefreshing}
        aria-label={isRefreshing ? 'Refreshing relays' : 'Refresh relays'}
        title={isRefreshing ? 'Refreshing relays' : 'Refresh relays'}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-wait disabled:opacity-70"
      >
        <RefreshIcon className={isRefreshing ? 'animate-spin' : ''} />
        <span className="hidden sm:inline">{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
      </button>
      {TABS.map(({ label, href, Icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            to={href}
            className={`inline-flex items-center gap-1.5 rounded-full border bg-zinc-950/80 px-3 py-1.5 text-sm transition ${
              isActive
                ? 'border-zinc-600 text-white'
                : 'border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white'
            }`}
          >
            <Icon />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
