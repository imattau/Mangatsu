const SHELL_CACHE = 'mangatsu-shell-v2'
const IMAGE_CACHE = 'mangatsu-images-v1'
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => (key === SHELL_CACHE || key === IMAGE_CACHE ? null : caches.delete(key))),
        )
      ),
      self.clients.claim(),
    ])
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)
  const isImageRequest =
    event.request.destination === 'image' || requestUrl.pathname.includes('/blob/')

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/index.html')
        return cached ?? caches.match('/')
      })
    )
    return
  }

  if (isImageRequest) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request)
        if (cachedResponse) {
          void fetch(event.request)
            .then((response) => {
              if (response.ok || response.type === 'opaque') {
                void cache.put(event.request, response.clone())
              }
            })
            .catch(() => {})
          return cachedResponse
        }

        try {
          const response = await fetch(event.request)
          if (response.ok || response.type === 'opaque') {
            void cache.put(event.request, response.clone())
          }
          return response
        } catch {
          return cachedResponse ?? Response.error()
        }
      })
    )
    return
  }

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) =>
      cachedResponse ??
      fetch(event.request).then((response) => {
        const responseClone = response.clone()
        void caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, responseClone))
        return response
      })
    )
  )
})
