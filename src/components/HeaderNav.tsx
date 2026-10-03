import { Link, useLocation } from 'react-router-dom'
import { Compass, LibraryBig } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TABS = [
  { label: 'Library', href: '/', Icon: LibraryBig },
  { label: 'Feed', href: '/feed', Icon: Compass },
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
          <Button key={href} asChild variant="outline" size="lg" className="h-9 rounded-full px-3">
            <Link to={href} aria-label={label}>
              <Icon />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}
