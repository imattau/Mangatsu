import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { useReadStore } from '@/stores/readStore'
import { cn } from '@/lib/utils'
import type { Chapter } from '@/types'

interface ChapterListDrawerProps {
  comicTitle?: string
  chapters: Chapter[]
  currentDTag: string
  chapterHref: (chapter: Chapter) => string
  /** Rendered as the drawer trigger; must be a single element that accepts a ref (e.g. a Button). */
  children: ReactNode
}

export function ChapterListDrawer({
  comicTitle,
  chapters,
  currentDTag,
  chapterHref,
  children,
}: ChapterListDrawerProps) {
  const progress = useReadStore((s) => s.progress)

  return (
    <Drawer>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Chapters</DrawerTitle>
          <DrawerDescription>
            {comicTitle ? `${comicTitle} · ` : ''}
            {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}
          </DrawerDescription>
        </DrawerHeader>
        <ul className="overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {chapters.map((chapter, idx) => {
            const isCurrent = chapter.dTag === currentDTag
            const pageCount = chapter.pageHashes.length
            const readPage = progress[chapter.dTag]?.page ?? 0
            const isRead = !isCurrent && pageCount > 0 && readPage >= pageCount
            const inProgress = !isCurrent && !isRead && readPage > 1

            return (
              <li key={chapter.dTag}>
                <DrawerClose asChild>
                  <Link
                    to={chapterHref(chapter)}
                    aria-current={isCurrent ? 'page' : undefined}
                    ref={isCurrent ? (el) => el?.scrollIntoView?.({ block: 'center' }) : undefined}
                    className={cn(
                      'flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted',
                      isCurrent && 'bg-muted',
                    )}
                  >
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          isCurrent ? 'font-medium' : isRead && 'text-muted-foreground',
                        )}
                      >
                        {chapter.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {isCurrent
                          ? 'Reading now'
                          : inProgress
                            ? `Page ${readPage} of ${pageCount}`
                            : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
                      </span>
                    </span>
                    {isRead && <Check aria-label="Read" className="size-4 shrink-0 text-muted-foreground" />}
                  </Link>
                </DrawerClose>
              </li>
            )
          })}
        </ul>
      </DrawerContent>
    </Drawer>
  )
}
