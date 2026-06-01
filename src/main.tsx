import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { NostrProvider } from '@/context/NostrContext'
import { router } from '@/router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NostrProvider>
      <RouterProvider router={router} />
    </NostrProvider>
  </StrictMode>
)
