const CACHE_NAME = 'jenbi-cache-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/arrivals.html',
  '/route.html',
  '/setting.html',
  '/styles.css',
  '/js/main.js',
  '/js/core/utils.js',
  '/js/core/storage.js',
  '/js/ui/shell.js',
  '/js/features/data.js',
  '/js/features/arrivals.js',
  '/js/features/route.js',
  '/data/data.json',
  '/data/places.json',
  '/data/place-to-stop.json',
  '/data/meta.json',
  '/data/manifest.json',
  '/images/jenbi_logo.png',
  '/images/menu.png',
  '/images/setting.png',
  '/images/home.png',
  '/images/bus.png',
  '/images/route.png',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

// 네비게이션 요청: 네트워크 우선, 실패시 캐시, 마지막으로 홈
async function handleNavigate(request) {
  try {
    const net = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, net.clone());
    return net;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    return cached || cache.match('/index.html');
  }
}

// 정적 자원: 캐시 우선, 네트워크로 갱신
async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then(res => { if (res && res.ok) cache.put(request, res.clone()); }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(handleNavigate(request));
  } else if (['style', 'script', 'image'].includes(request.destination) || url.pathname.startsWith('/data/')) {
    event.respondWith(handleAsset(request));
  }
});