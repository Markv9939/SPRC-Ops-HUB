const CACHE_NAME = 'sprc-ops-shell-v12'
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/branding/sprc-mark-white.png',
  '/branding/sprc-mark-red-solid.png'
]

function normalizeAssetUrl(path) {
  const value = String(path || '').trim()
  if (!value) return null
  return value.startsWith('/') ? value : `/${value}`
}

function buildAssetUrls(manifest) {
  const urls = new Set()
  Object.values(manifest || {}).forEach(entry => {
    const entryAssets = [entry?.file, ...(entry?.css || []), ...(entry?.assets || [])]
    entryAssets
      .map(normalizeAssetUrl)
      .filter(Boolean)
      .forEach(url => urls.add(url))
  })
  return [...urls]
}

async function cacheUrls(cache, urls) {
  await Promise.all(urls.map(async url => {
    // A first visit may have already placed a conditional copy in the browser's
    // HTTP cache before this worker gained control. Force a complete response
    // body so Cache Storage never receives an empty/partial hashed module.
    const response = await fetch(new Request(url, { cache: 'reload' }))
    if (!response.ok) throw new Error(`Unable to cache ${url}: ${response.status}`)
    await cache.put(url, response)
  }))
}

async function loadProductionBuildAssets(cache) {
  try {
    const response = await fetch('/asset-manifest.json', { cache: 'no-store' })
    if (!response.ok) return []
    const copy = response.clone()
    const manifest = await response.json()
    await cache.put('/asset-manifest.json', copy)
    return buildAssetUrls(manifest)
  } catch {
    // Vite development mode has no production manifest. The runtime-cache
    // fallback below keeps local development and focused emulator tests usable.
    return []
  }
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cacheUrls(cache, APP_SHELL)

  const productionAssets = await loadProductionBuildAssets(cache)
  if (productionAssets.length > 0) {
    await cacheUrls(cache, productionAssets)
    return
  }

  const indexResponse = await cache.match('/index.html')
  if (!indexResponse) return
  const html = await indexResponse.text()
  const assetUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
    .map(match => match[1])
    .filter(path => path.startsWith('/assets/'))
  if (assetUrls.length > 0) await cacheUrls(cache, assetUrls)
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
      // Precached production assets are stored before the worker sees the
      // browser's final script/style request headers. Match by URL even when a
      // development or hosting response includes a Vary header.
      .catch(() => caches.match(request, { ignoreVary: true }))
  )
})
