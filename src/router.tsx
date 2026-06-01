import { createBrowserRouter } from 'react-router-dom'
import { LibraryScreen } from '@/screens/Library'
import { ComicDetailScreen } from '@/screens/ComicDetail'
import { ReaderScreen } from '@/screens/Reader'
import { UploadScreen } from '@/screens/Upload'
import { SettingsScreen } from '@/screens/Settings'

export const router = createBrowserRouter([
  { path: '/', element: <LibraryScreen /> },
  { path: '/comic/:comicId', element: <ComicDetailScreen /> },
  { path: '/comic/:comicId/chapter/:chapterId', element: <ReaderScreen /> },
  { path: '/upload', element: <UploadScreen /> },
  { path: '/settings', element: <SettingsScreen /> },
])
