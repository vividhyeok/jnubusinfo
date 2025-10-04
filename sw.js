self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
  // 캐싱 로직 추가 가능 (선택)
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating.');
});

self.addEventListener('fetch', (event) => {
  // 오프라인 캐싱 없음, 기본 패스스루
});