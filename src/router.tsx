/* eslint-disable react-refresh/only-export-components */
import { Suspense, lazy, useEffect, useState } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { useAuthStore } from '@/stores/authStore'
import { ReaderScreen } from '@/screens/Reader'

const LoginScreen = lazy(() => import('@/screens/Login').then((module) => ({ default: module.LoginScreen })))
const LibraryScreen = lazy(() => import('@/screens/Library').then((module) => ({ default: module.LibraryScreen })))
const ComicDetailScreen = lazy(() => import('@/screens/ComicDetail').then((module) => ({ default: module.ComicDetailScreen })))
const UploadScreen = lazy(() => import('@/screens/Upload').then((module) => ({ default: module.UploadScreen })))
const SettingsScreen = lazy(() => import('@/screens/Settings').then((module) => ({ default: module.SettingsScreen })))
const FeedScreen = lazy(() => import('@/screens/Feed').then((module) => ({ default: module.FeedScreen })))

function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-sm text-zinc-500">
      Loading...
    </div>
  )
}

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

  return pubkey ? (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  ) : (
    <Navigate to="/login" replace />
  )
}

function LoginRoute() {
  const pubkey = useAuthStore((state) => state.pubkey)
  const hydrated = useAuthHydrated()

  if (!hydrated) {
    return null
  }

  return pubkey ? (
    <Navigate to="/" replace />
  ) : (
    <Suspense fallback={<RouteFallback />}>
      <LoginScreen />
    </Suspense>
  )
}

export const router = createBrowserRouter(
  [
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
            { path: '/comic/:dTag/chapter/:chapterId/edit', element: <UploadScreen /> },
            { path: '/comic/:dTag/edit', element: <UploadScreen /> },
            { path: '/settings', element: <SettingsScreen /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
)
