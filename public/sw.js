const SHELL_CACHE = 'mangatsu-shell-v2'
const IMAGE_CACHE = 'mangatsu-images-v1'
const SCOPE_PATH = new URL('./', self.location).pathname
const APP_SHELL_URL = `${SCOPE_PATH}index.html`
const PRECACHE_URLS = [SCOPE_PATH, APP_SHELL_URL, `${SCOPE_PATH}manifest.webmanifest`, `${SCOPE_PATH}favicon.webp`]

async function cacheRemoteImages(urls) {
  const cache = await caches.open(IMAGE_CACHE)
  for (const url of urls) {
    try {
      const response = await fetch(url, { mode: 'no-cors', cache: 'no-store' })
      if (response.ok || response.type === 'opaque') {
        await cache.put(url, response.clone())
      }
    } catch {
      // Ignore individual asset failures so one bad URL does not abort the pack.
    }
  }
}

async function removeRemoteImages(urls) {
  const cache = await caches.open(IMAGE_CACHE)
  await Promise.all(urls.map((url) => cache.delete(url)))
}

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
        const cached = await caches.match(APP_SHELL_URL)
        return cached ?? caches.match(SCOPE_PATH)
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

self.addEventListener('message', (event) => {
  if (event.origin !== self.location.origin) {
    return
  }

  const data = event.data || {}
  const requestId = data.requestId
  const reply = (payload) => {
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage({ requestId, ...payload })
    }
  }

  if (data.type === 'CACHE_COMIC_OFFLINE' && Array.isArray(data.urls)) {
    event.waitUntil(
      cacheRemoteImages(data.urls).then(() => reply({ type: data.type, ok: true })).catch(() => reply({ type: data.type, ok: false }))
    )
  }

  if (data.type === 'REMOVE_COMIC_OFFLINE' && Array.isArray(data.urls)) {
    event.waitUntil(
      removeRemoteImages(data.urls).then(() => reply({ type: data.type, ok: true })).catch(() => reply({ type: data.type, ok: false }))
    )
  }
})
