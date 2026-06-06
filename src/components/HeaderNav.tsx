import { Link, useLocation } from 'react-router-dom'

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

const TABS = [
  { label: 'Library', href: '/', Icon: LibraryIcon },
  { label: 'Feed', href: '/feed', Icon: FeedIcon },
]

export function HeaderNav() {
  const { pathname } = useLocation()

  return (
    <nav className="flex items-center gap-1">
      {TABS.map(({ label, href, Icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
        if (isActive) {
          return null
        }
        return (
          <Link
            key={href}
            to={href}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            <Icon />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
