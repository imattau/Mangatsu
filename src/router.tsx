/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
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

function useAuthHydrated() {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated())

  useEffect(() => {
    return useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })
  }, [])

  return hydrated
}

function ProtectedRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  const hydrated = useAuthHydrated()

  if (!hydrated) {
    return null
  }

  return pubkey ? <Outlet /> : <Navigate to="/login" replace />
}

function LoginRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  const hydrated = useAuthHydrated()

  if (!hydrated) {
    return null
  }

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
          { path: '/comic/:dTag/edit', element: <UploadScreen /> },
          { path: '/settings', element: <SettingsScreen /> },
        ],
      },
    ],
  },
])
