/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { LoginScreen } from '@/screens/Login'
import { LibraryScreen } from '@/screens/Library'
import { ComicDetailScreen } from '@/screens/ComicDetail'
import { ReaderScreen } from '@/screens/Reader'
import { UploadScreen } from '@/screens/Upload'
import { SettingsScreen } from '@/screens/Settings'
import { FeedScreen } from '@/screens/Feed'
import { AppLayout } from '@/components/AppLayout'
import { useAuthStore } from '@/stores/authStore'

function ProtectedRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  return pubkey ? <Outlet /> : <Navigate to="/login" replace />
}

function LoginRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  return pubkey ? <Navigate to="/" replace /> : <LoginScreen />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <LibraryScreen /> },
          { path: '/feed', element: <FeedScreen /> },
          { path: '/comic/:dTag', element: <ComicDetailScreen /> },
          { path: '/comic/:dTag/chapter/:chapterId', element: <ReaderScreen /> },
          { path: '/upload', element: <UploadScreen /> },
          { path: '/comic/:dTag/upload', element: <UploadScreen /> },
          { path: '/settings', element: <SettingsScreen /> },
        ],
      },
    ],
  },
])
