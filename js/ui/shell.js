// Common shell: drawer, bottom nav, swipe, SW, offline banner
export function initShell() {
  const $drawer = document.getElementById('drawer');
  const $menuBtn = document.getElementById('menu-btn');
  const $drawerBackdrop = document.getElementById('drawer-backdrop');
  if ($menuBtn && $drawer && $drawerBackdrop) {
    const closeDrawer = () => $drawer.classList.remove('open');
    $menuBtn.addEventListener('click', () => $drawer.classList.toggle('open'));
    $drawerBackdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }
  const path = window.location.pathname;
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    try {
      const target = new URL(a.getAttribute('href'), window.location.href).pathname;
      a.classList.toggle('active', target === path);
    } catch {
      // fallback: endsWith 비교
      a.classList.toggle('active', path.endsWith(a.getAttribute('href') || ''));
    }
  });
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length) touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : touchStartX;
    const dx = endX - touchStartX;
    const threshold = 60;
    if (Math.abs(dx) > threshold) {
      if (dx < 0) {
        if (path.endsWith('/arrivals.html')) window.location.href = 'route.html';
      } else {
        if (path.endsWith('/route.html')) window.location.href = 'arrivals.html';
      }
    }
  }, { passive: true });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
  initOfflineBanner();
}

export function initOfflineBanner() {
  const ensure = () => {
    let el = document.getElementById('offline-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'offline-banner';
      el.className = 'offline-banner';
      el.textContent = '오프라인 모드: 최신 정보가 아닐 수 있어요';
      document.body.appendChild(el);
    }
    el.style.display = navigator.onLine ? 'none' : 'block';
  };
  window.addEventListener('online', ensure);
  window.addEventListener('offline', ensure);
  ensure();
}
