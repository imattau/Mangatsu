import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { NostrProvider } from '@/context/NostrContext'
import { router } from '@/router'
import './index.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NostrProvider>
      <RouterProvider router={router} />
    </NostrProvider>
  </StrictMode>
)
