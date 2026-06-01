import { Link, useLocation } from 'react-router-dom'

const TABS = [
  { label: 'Library', href: '/', icon: '📚' },
  { label: 'Feed', href: '/feed', icon: '🔍' },
]

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      {TABS.map(({ label, href, icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            to={href}
            className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs transition ${
              isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
