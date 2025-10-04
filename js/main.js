import { loadData, getRoute, getBuildingForStop, getStop } from './features/data.js';
import { readMeta, writeMeta } from './core/storage.js';
import { initShell } from './ui/shell.js';
import { nowMinutesLocal, minToHHMM, hhmmToMin, getChosung } from './core/utils.js';
import { renderNow, computeNextArrivalsAdvanced, buildTimetableAdvanced } from './features/arrivals.js';
import { calculateRoute } from './features/route.js';

let DATA = null;
let META = {
  favorites: [],
  prefs: { defaultTab: 'arrivals', defaultDirectionId: null, pinFavoritesOnTop: true, showSoonOnlyMinutes: 0, maxSummaryCount: 0 },
  last: { directionId: null, start: '', end: '' },
  recentDests: []
};
let HAS_SAVED_META = false;

const isArrivals = window.location.pathname.includes('arrivals.html');
const isRoute = window.location.pathname.includes('route.html');
const isSetting = window.location.pathname.includes('setting.html');
const isHome = window.location.pathname.endsWith('/index.html') || /\/$/.test(window.location.pathname);
let currentTab = (window.location.pathname.includes('route.html')) ? 'route' : 'arrivals';
let timetableMode = 'compact';

// Elements
const $direction = isArrivals ? document.getElementById('direction-select') : null;
const $refreshNow = isArrivals ? document.getElementById('refresh-now') : null;
const $toggle = isArrivals ? document.getElementById('toggle-timetable') : null;
const $startBuilding = isRoute ? document.getElementById('start-building') : null;
const $endBuilding = isRoute ? document.getElementById('end-building') : null;
const $startSuggestions = isRoute ? document.getElementById('start-suggestions') : null;
const $endSuggestions = isRoute ? document.getElementById('end-suggestions') : null;
const $routeResult = isRoute ? document.getElementById('route-result') : null;
const $nowText = isArrivals ? document.getElementById('now-text') : null;
const $next = isArrivals ? document.getElementById('next-arrivals') : null;
const $table = isArrivals ? document.getElementById('timetable') : null;
const $favorites = document.getElementById('favorites');
const $settingsStops = document.getElementById('settings-stops');
const $settingsSearch = document.getElementById('settings-search');
const $settingsMaxSummary = document.getElementById('settings-max-summary');
const $settingsPinFav = document.getElementById('settings-pin-fav');
const $settingsSave = document.getElementById('settings-save');
const $settingsCancel = document.getElementById('settings-cancel');
const $recentDests = document.getElementById('recent-dests');
const $exportArea = document.getElementById('settings-export');
const $btnExportCopy = document.getElementById('btn-export-copy');
const $btnImportApply = document.getElementById('btn-import-apply');
const $settingsClose = document.getElementById('settings-close');

let lastActiveInput = null;
// PWA: Service Worker 등록
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
// simple debounce utility
function debounce(fn, delay = 300) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// PWA 설치 프롬프트 핸들러
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('install-app');
  if (btn) btn.style.display = 'inline-flex';
});

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice.catch(()=>({outcome:'dismissed'}));
  deferredPrompt = null;
  const btn = document.getElementById('install-app');
  if (btn) btn.style.display = 'none';
  return outcome === 'accepted';
}

function readWriteMeta(initOnly=false) {
  const saved = readMeta();
  if (saved) { META = Object.assign(META, saved); HAS_SAVED_META = true; }
  if (initOnly) return; writeMeta(META);
}

async function loadAndApplyMetaConfig() {
  // 1) script#app-config(type=application/json)
  let cfg = null;
  const script = document.getElementById('app-config');
  if (script && script.textContent) {
    try { cfg = JSON.parse(script.textContent); } catch {}
  }
  // 2) head meta tags
  const readMetaTag = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
  const tagCfg = {
    defaultTab: readMetaTag('app:default-tab') || undefined,
    defaultDirectionId: readMetaTag('app:default-direction-id') || undefined,
    pinFavoritesOnTop: readMetaTag('app:pin-favorites-on-top'),
    showSoonOnlyMinutes: readMetaTag('app:show-soon-only-minutes'),
    maxSummaryCount: readMetaTag('app:max-summary-count')
  };
  // normalize types for tagCfg
  if (typeof tagCfg.pinFavoritesOnTop === 'string') tagCfg.pinFavoritesOnTop = tagCfg.pinFavoritesOnTop === 'true';
  if (typeof tagCfg.showSoonOnlyMinutes === 'string') tagCfg.showSoonOnlyMinutes = parseInt(tagCfg.showSoonOnlyMinutes, 10);
  if (typeof tagCfg.maxSummaryCount === 'string') tagCfg.maxSummaryCount = parseInt(tagCfg.maxSummaryCount, 10);

  // 3) external static config file (optional)
  if (!cfg) {
    try {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      if (res.ok) cfg = await res.json();
    } catch {}
  }
  // 4) window global (optional)
  if (!cfg && window.__APP_CONFIG__) cfg = window.__APP_CONFIG__;

  const merged = Object.assign({}, tagCfg, cfg || {});
  // apply as defaults (do NOT override user-saved values)
  if (merged.defaultTab && !META.prefs?.defaultTab) META.prefs.defaultTab = merged.defaultTab;
  if (typeof merged.defaultDirectionId !== 'undefined' && !META.prefs?.defaultDirectionId)
    META.prefs.defaultDirectionId = merged.defaultDirectionId;
  if (typeof merged.pinFavoritesOnTop === 'boolean' && typeof META.prefs?.pinFavoritesOnTop === 'undefined')
    META.prefs.pinFavoritesOnTop = merged.pinFavoritesOnTop;
  if (typeof merged.showSoonOnlyMinutes === 'number' && (META.prefs?.showSoonOnlyMinutes === 0 || typeof META.prefs?.showSoonOnlyMinutes === 'undefined'))
    META.prefs.showSoonOnlyMinutes = merged.showSoonOnlyMinutes;
  if (typeof merged.maxSummaryCount === 'number' && (META.prefs?.maxSummaryCount === 0 || typeof META.prefs?.maxSummaryCount === 'undefined'))
    META.prefs.maxSummaryCount = merged.maxSummaryCount;

  if (!HAS_SAVED_META) writeMeta(META);
}

function writeMetaDebounced() { writeMeta(META); }

function enableFavoritesDrag(container) {
  if (!container) return;
  let dragging = null;
  container.querySelectorAll('.item').forEach(item => {
    const handle = item.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => { item.draggable = true; });
      handle.addEventListener('mouseup', () => { item.draggable = false; });
      handle.addEventListener('touchstart', () => { item.draggable = true; }, { passive: true });
      handle.addEventListener('touchend', () => { item.draggable = false; }, { passive: true });
    }
    item.addEventListener('dragstart', () => { dragging = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragging = null; item.draggable = false; saveOrder(); });
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault(); if (!dragging) return;
    const after = getDragAfterElement(container, e.clientY);
    if (after == null) container.appendChild(dragging); else container.insertBefore(dragging, after);
  });
  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
  function saveOrder() {
    const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    const order = Array.from(container.querySelectorAll('.item')).map(el => el.querySelector('input').value);
    const newFavs = order.filter(v => selected.includes(v));
    META.favorites = newFavs.slice(0, 8);
    writeMetaDebounced();
    applyPersonalization();
  }
}

function buildSettingsStops() {
  if (!$settingsStops || !DATA) return;
  const allBuildings = DATA.places.buildings.map(b => b.name).sort((a,b)=>a.localeCompare(b,'ko'));
  const searchTerm = ($settingsSearch?.value || '').toLowerCase();
  const searchChosung = getChosung(searchTerm.replace(/\s+/g, ''));
  const filteredBuildings = allBuildings.filter(name => {
    const nameNorm = name.replace(/\s+/g, '').toLowerCase();
    const nameChosung = getChosung(nameNorm);
    return nameNorm.includes(searchTerm) || nameChosung.includes(searchChosung);
  });
  // 유효하지 않은 즐겨찾기 제거
  META.favorites = META.favorites.filter(f => allBuildings.includes(f));
  writeMetaDebounced();
  $settingsStops.innerHTML = filteredBuildings.map(name => {
    const checked = META.favorites.includes(name) ? 'checked' : '';
    return `<label class="item"><input type="checkbox" value="${name}" ${checked}> <span>${name}</span><span class="drag-handle" title="순서 변경">≡</span></label>`;
  }).join('');
  if ($settingsMaxSummary) $settingsMaxSummary.value = META.prefs?.maxSummaryCount || 0;
  if ($settingsPinFav) $settingsPinFav.checked = META.prefs?.pinFavoritesOnTop !== false;
  enableFavoritesDrag($settingsStops);

  // 체크박스 변경 시 즐겨찾기 즉시 반영 (현재 순서 유지)
  $settingsStops.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const selected = Array.from($settingsStops.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
      const order = Array.from($settingsStops.querySelectorAll('.item')).map(el => el.querySelector('input').value);
      META.favorites = order.filter(v => selected.includes(v)).slice(0,8);
      writeMetaDebounced();
      applyPersonalization();
    });
  });

  // 저장/취소 버튼 동작
  if ($settingsSave) {
    $settingsSave.onclick = () => {
      if ($settingsMaxSummary) {
        const n = parseInt($settingsMaxSummary.value, 10);
        META.prefs.maxSummaryCount = isNaN(n) ? 0 : Math.max(0, Math.min(50, n));
      }
      if ($settingsPinFav) {
        META.prefs.pinFavoritesOnTop = !!$settingsPinFav.checked;
      }
      writeMetaDebounced();
      applyPersonalization();
      if (isArrivals) refreshAll();
      alert('설정을 저장했어요.');
    };
  }
  if ($settingsCancel) {
    $settingsCancel.onclick = () => { history.back(); };
  }
  // 헤더의 홈(닫기) 버튼으로 나갈 때도 현재 설정을 반영
  if ($settingsClose) {
    $settingsClose.addEventListener('click', (e) => {
      // 현재 입력값을 META에 반영 후 진행
      if ($settingsMaxSummary) {
        const n = parseInt($settingsMaxSummary.value, 10);
        META.prefs.maxSummaryCount = isNaN(n) ? 0 : Math.max(0, Math.min(50, n));
      }
      if ($settingsPinFav) {
        META.prefs.pinFavoritesOnTop = !!$settingsPinFav.checked;
      }
      if ($themeColor) {
        META.prefs.themeColor = $themeColor.value || META.prefs.themeColor || '#007bff';
      }
      writeMetaDebounced();
      applyPersonalization();
      applyThemeColor();
    }, { passive: true });
  }
}

function applyPersonalization() {
  if ($favorites) {
    $favorites.innerHTML = META.favorites.map(n => `<button class="chip favorite" data-building="${n}" data-stop="${getStop(DATA, n)}">${n}</button>`).join('');
    $favorites.querySelectorAll('button[data-stop]').forEach(btn => {
      btn.addEventListener('click', () => onFavoriteClick(btn));
    });
  }
  if ($recentDests) {
    const list = (META.recentDests || []).slice(0, 6);
    $recentDests.innerHTML = list.map(n => `<button class="chip" data-dest="${n}">${n}</button>`).join('');
    $recentDests.querySelectorAll('button[data-dest]').forEach(btn => {
      btn.addEventListener('click', () => {
        if ($endBuilding) $endBuilding.value = btn.dataset.dest; doRoute();
      });
    });
  }
}

function onFavoriteClick(btn) {
  const buildingName = btn.dataset.building;
  if (isArrivals) {
    const card = Array.from(document.querySelectorAll('.highlight-card .stop')).find(el => el.textContent === buildingName);
    if (card) card.closest('.highlight-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (isRoute) {
    if (lastActiveInput === $startBuilding) {
      $startBuilding.value = buildingName; doRoute();
    } else if (lastActiveInput === $endBuilding) {
      $endBuilding.value = buildingName; doRoute();
    } else {
      // 기본: 출발 우선
      if (!$startBuilding.value) { $startBuilding.value = buildingName; doRoute(); return; }
      if (!$endBuilding.value) { $endBuilding.value = buildingName; doRoute(); return; }
      $startBuilding.value = buildingName; doRoute();
    }
  }
}

function getDirection() { return DATA.routes.find(r => r.directionId === $direction.value) || DATA.routes[0]; }

function renderTable(direction) {
  const rows = buildTimetableAdvanced(DATA, direction);
  const allTimes = Array.from(new Set(rows.flatMap(r => r.times))).sort((a,b)=>a-b);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  let th = document.createElement('th'); th.textContent = '정류장'; trh.appendChild(th);
  allTimes.forEach(t => { const tht = document.createElement('th'); tht.textContent = minToHHMM(t); trh.appendChild(tht); });
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r => { const tr = document.createElement('tr'); const ths = document.createElement('th'); ths.textContent = r.stop; tr.appendChild(ths); allTimes.forEach(t => { const td = document.createElement('td'); td.textContent = r.times.includes(t) ? '●' : ''; tr.appendChild(td); }); tbody.appendChild(tr); });
  table.appendChild(tbody);
  const $table = document.getElementById('timetable');
  $table.innerHTML = ''; $table.appendChild(table);
}

function renderCompactTimetable(direction) {
  const nowMin = nowMinutesLocal();
  const route = DATA.routes.find(r => r.directionId === direction.directionId);
  const container = document.createElement('div'); container.className = 'stop-list';
  let stopNames = Object.keys(route.stops);
  const favSet = new Set(META.prefs?.pinFavoritesOnTop !== false ? META.favorites : []);
  stopNames.sort((a,b)=> (favSet.has(a)?0:1) - (favSet.has(b)?0:1) || a.localeCompare(b,'ko'));
  stopNames.forEach(stopName => {
    const times = route.stops[stopName].map(h => hhmmToMin(h)).sort((a,b)=>a-b);
    let upcoming = times.filter(t => t >= nowMin);
    const soonN = META.prefs?.showSoonOnlyMinutes || 0; if (soonN > 0) upcoming = upcoming.filter(t => (t - nowMin) <= soonN);
    const next3 = upcoming.slice(0, 3);
    const card = document.createElement('div'); card.className = 'stop-card';
    const chips = next3.map(t => `<span class="chip">${minToHHMM(t)}</span>`).join('');
    const moreCount = Math.max(0, upcoming.length - next3.length);
    let lastHour = null;
    const allChips = times.map(t => { const h = Math.floor(t/60); const label = (h !== lastHour) ? `<div class="hour-label">${String(h).padStart(2,'0')}시</div>` : ''; lastHour = h; return `${label}<span class="time-chip">${minToHHMM(t)}</span>`; }).join('');
    card.innerHTML = `
      <div class="header">
        <div class="title">${stopName}</div>
        <div class="next-chips">${chips || '<span class="chip">운행 없음</span>'}${moreCount ? `<span class="chip muted">+${moreCount}</span>` : ''}</div>
      </div>
      <details>
        <summary>전체 보기</summary>
        <div class="all-times">${allChips}</div>
      </details>`;
    container.appendChild(card);
  });
  const $table = document.getElementById('timetable'); $table.innerHTML = ''; $table.appendChild(container);
}

function renderTimetable(direction) { if (timetableMode === 'compact') return renderCompactTimetable(direction); return renderTable(direction); }

function renderNext(direction) {
  const nowMin = nowMinutesLocal();
  let list = computeNextArrivalsAdvanced(DATA, direction, nowMin);
  const favSet = new Set(META.prefs?.pinFavoritesOnTop !== false ? META.favorites : []);
  if (favSet.size) list.sort((a,b)=> (favSet.has(a.stop)?0:1) - (favSet.has(b.stop)?0:1));
  const soonN = META.prefs?.showSoonOnlyMinutes || 0; if (soonN > 0) list = list.filter(it => it.current && it.current.eta <= soonN);
  const maxN = META.prefs?.maxSummaryCount || 0; if (maxN > 0) list = list.slice(0, Math.max(0, maxN));
  const $next = document.getElementById('next-arrivals'); $next.innerHTML = '';
  list.forEach(item => {
    const div = document.createElement('div'); div.className = 'highlight-card';
    const eta = item.current ? item.current.eta : null; let etaClass = 'eta-later'; if (eta !== null) { if (eta <= 2) etaClass = 'eta-soon'; else if (eta <= 7) etaClass = 'eta-near'; }
    const spanWidth = eta !== null ? Math.max(0, Math.min(100, (12 - eta) / 12 * 100)) : 0;
    const chips = item.isLast && item.current ? `<div class="chips"><span class="chip">막차</span></div>` : '';
    const etaBadge = item.current ? `<span class="eta-badge ${etaClass}">${eta === 0 ? '곧 도착' : eta + '분'}</span>` : `<span class="chip">운행 없음</span>`;
    const nextText = item.next ? `<div class="sub">다음 ${item.next.time} (${item.next.eta}분)</div>` : `<div class="sub">다음 없음</div>`;
    div.innerHTML = `<div class="left"><div class="stop">${item.stop}</div><div class="time">${item.current ? item.current.time : '-'}</div>${chips}${nextText}<div class="meter"><span style="width:${spanWidth}%"></span></div></div><div class="right">${etaBadge}</div>`;
    $next.appendChild(div);
  });
  if (focusStop) { const el = Array.from(document.querySelectorAll('.highlight-card .stop')).find(e=>e.textContent===focusStop); if (el) el.closest('.highlight-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); focusStop = null; }
}

function updateSuggestions(input, suggestionsDiv) {
  const query = input.value || '';
  const queryLower = query.toLowerCase();
  const queryNorm = queryLower.replace(/\s+/g, '');
  const queryChosung = getChosung(queryNorm);
  const queryHangul = queryNorm.replace(/[^가-힣]/g, '');

  // 별칭: 사용자 표현을 표준 건물명으로 매핑 (제안 표시는 별칭, 클릭 시 표준명 입력)
  const aliasMap = {
    '정문 및 경비실': '정문 및 수위실',
    '경비실': '정문 및 수위실',
    '수위실': '정문 및 수위실',
    '정문': '정문 및 수위실',
    '감귤화훼': '감귤화훼과학기술센터',
    '감귤화훼센터': '감귤화훼과학기술센터',
    '감귤화훼과학': '감귤화훼과학기술센터'
  };

  const allBuildings = DATA?.places?.buildings?.map(b => b.name) || [];
  const mappedBuildings = Object.keys(DATA?.buildings || {});
  const busStops = Object.keys(DATA?.bus_stops || {});
  // 검색 풀 구성: 즐겨찾기 우선, 그 외 전체(중복 제거)
  const poolSet = new Set([...(Array.isArray(META.favorites) ? META.favorites : []), ...allBuildings, ...mappedBuildings, ...busStops]);
  // 별칭 키도 풀에 추가
  Object.keys(aliasMap).forEach(k => poolSet.add(k));

  const pool = Array.from(poolSet);
  const favs = new Set(Array.isArray(META.favorites) ? META.favorites : []);

  function matches(name) {
    const nameNorm = (name || '').replace(/\s+/g, '').toLowerCase();
    const nameChosung = getChosung(nameNorm);
    const nameHangul = nameNorm.replace(/[^가-힣]/g, '');
    if (nameNorm.includes(queryNorm) || nameChosung.includes(queryChosung)) return true;
    if (queryHangul.length >= 2) {
      const head3 = queryHangul.slice(0, 3);
      const head2 = queryHangul.slice(0, 2);
      if ((head3 && nameHangul.includes(head3)) || (head2 && nameHangul.includes(head2))) return true;
    }
    return false;
  }

  const candidates = pool.filter(n => queryNorm.length > 0 && matches(n));
  // 즐겨찾기 우선 정렬
  candidates.sort((a,b)=> (favs.has(a)?0:1) - (favs.has(b)?0:1) || a.localeCompare(b,'ko'));

  // {label, value} 구성 (별칭이면 value=표준명)
  const items = candidates.slice(0, 12).map(label => ({ label, value: aliasMap[label] || label }));

  suggestionsDiv.innerHTML = '';
  if (items.length > 0) {
    items.forEach(item => {
      const div = document.createElement('div');
      div.textContent = item.label;
      div.onclick = () => { input.value = item.value; suggestionsDiv.style.display = 'none'; doRoute(); };
      suggestionsDiv.appendChild(div);
    });
    suggestionsDiv.style.display = 'block';
  } else {
    suggestionsDiv.style.display = 'none';
  }
}

function doRoute() {
  if (!isRoute) return;
  if (!$routeResult) return;
  const startVal = ($startBuilding?.value || '').trim();
  const endVal = ($endBuilding?.value || '').trim();
  if (!startVal || !endVal) { $routeResult.innerHTML = ''; return; }
  const { ok, endName } = calculateRoute(DATA, $routeResult, startVal, endVal);
  // 최근 목적지 반영
  if (ok && endName) { META.recentDests = [endName, ...META.recentDests.filter(n => n !== endName)].slice(0, 6); writeMetaDebounced(); applyPersonalization(); }
  // last 저장
  META.last.start = $startBuilding?.value || ''; META.last.end = $endBuilding?.value || ''; writeMetaDebounced();
}

function updateURL() {
  const params = new URLSearchParams(); params.set('tab', currentTab);
  if (currentTab === 'arrivals') { params.set('direction', $direction.value); }
  else if (currentTab === 'route') { if ($startBuilding.value) params.set('start', $startBuilding.value); if ($endBuilding.value) params.set('end', $endBuilding.value); }
  history.replaceState(null, '', '?' + params.toString());
  if (currentTab === 'arrivals' && $direction) { META.last.directionId = $direction.value; }
  else if (currentTab === 'route') { META.last.start = $startBuilding?.value || ''; META.last.end = $endBuilding?.value || ''; }
  writeMetaDebounced();
}

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') || 'arrivals'; currentTab = tab;
  if (tab === 'arrivals') { const direction = params.get('direction'); if (direction && $direction) $direction.value = direction; }
  else if (tab === 'route') { const start = params.get('start'); const end = params.get('end'); if (start && $startBuilding) $startBuilding.value = start; if (end && $endBuilding) $endBuilding.value = end; }
  if (window.location.hash) {
    const m = /f=([^&]+)/.exec(window.location.hash); if (m && m[1]) { const favs = decodeURIComponent(m[1]).split(',').filter(Boolean); if (favs.length) { META.favorites = Array.from(new Set(favs)).slice(0, 8); writeMetaDebounced(); } }
    const fs = /fs=([^&]+)/.exec(window.location.hash); if (fs && fs[1]) focusStop = decodeURIComponent(fs[1]);
  }
}

function applyDefaultsAndLastUsed() {
  // 홈에서는 자동으로 다른 탭으로 이동하지 않습니다(사용자 요청으로 비활성화)
  if (isArrivals && $direction && DATA) { const pref = META.prefs?.defaultDirectionId || META.last?.directionId; if (pref && DATA.routes.some(r=>r.directionId===pref)) $direction.value = pref; refreshAll(); }
  if (isRoute && $startBuilding && $endBuilding) { if (META.last?.start) $startBuilding.value = META.last.start; if (META.last?.end) $endBuilding.value = META.last.end; if ($startBuilding.value && $endBuilding.value) doRoute(); }
}

function initSelectors() {
  if (isArrivals) {
    $direction.innerHTML = DATA.routes.map(r => `<option value="${r.directionId}">${r.route}</option>`).join('');
    $refreshNow?.addEventListener('click', (e) => { e.preventDefault(); renderNow(document.getElementById('now-text')); const dir = getDirection(); renderNext(dir); renderTimetable(dir); });
    $direction?.addEventListener('change', () => { META.last.directionId = $direction.value; writeMetaDebounced(); refreshAll(); updateURL(); });
    $toggle?.addEventListener('click', (e) => { e.preventDefault(); timetableMode = (timetableMode === 'compact') ? 'table' : 'compact'; const dir = getDirection(); renderTimetable(dir); $toggle.textContent = (timetableMode === 'compact') ? '표로 보기' : '요약으로 보기'; });
  } else if (isRoute) {
    const debouncedCalc = debounce(() => doRoute(), 250);
    $startBuilding?.addEventListener('input', () => { updateSuggestions($startBuilding, $startSuggestions); debouncedCalc(); });
    $startBuilding?.addEventListener('change', () => { META.last.start = $startBuilding.value || ''; writeMetaDebounced(); });
    $startBuilding?.addEventListener('blur', () => { META.last.start = $startBuilding.value || ''; writeMetaDebounced(); });
    $startBuilding?.addEventListener('focus', () => lastActiveInput = $startBuilding);
    $startBuilding?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRoute(); }});
    $endBuilding?.addEventListener('input', () => { updateSuggestions($endBuilding, $endSuggestions); debouncedCalc(); });
    $endBuilding?.addEventListener('change', () => { META.last.end = $endBuilding.value || ''; writeMetaDebounced(); });
    $endBuilding?.addEventListener('blur', () => { META.last.end = $endBuilding.value || ''; writeMetaDebounced(); });
    $endBuilding?.addEventListener('focus', () => lastActiveInput = $endBuilding);
    $endBuilding?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRoute(); }});
  }
}

function refreshAll() {
  if (isArrivals) {
    renderNow(document.getElementById('now-text'));
    const dir = getDirection(); renderNext(dir); renderTimetable(dir);
    if ($toggle) $toggle.textContent = (timetableMode === 'compact') ? '표로 보기' : '요약으로 보기';
  } else if (isRoute) { doRoute(); }
}

function initQAToggles() {
  const list = document.getElementById('qa-list');
  if (!list) return;
  list.querySelectorAll('.qa-item .qa-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.qa-item');
      if (!item) return;
      item.classList.toggle('open');
    });
  });

  // 후원: 계좌 복사 동작
  const copyBtn = document.getElementById('copy-account');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = copyBtn.getAttribute('data-account') || '';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        }
  alert('개발자의 계좌번호가 복사됐습니다. 후원해주셔서 감사합니다!');
      } catch (e) {
        alert('복사에 실패했습니다. 수동으로 복사해 주세요: ' + text);
      }
    });
  }
}

function initBackupRestore() {
  if ($exportArea) {
    // 초기 표시: 현재 META를 pretty JSON으로
    try { $exportArea.value = JSON.stringify(META, null, 2); } catch {}
  }
  if ($btnExportCopy && $exportArea) {
    $btnExportCopy.addEventListener('click', async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText($exportArea.value);
          alert('설정을 클립보드에 복사했어요.');
        } else {
          $exportArea.select(); document.execCommand('copy');
          alert('설정을 클립보드에 복사했어요.');
        }
      } catch (e) { alert('복사에 실패했습니다. 수동으로 복사해 주세요.'); }
    });
  }
  if ($btnImportApply && $exportArea) {
    $btnImportApply.addEventListener('click', () => {
      try {
        const obj = JSON.parse($exportArea.value);
        // 최소한의 스키마 머지: 예상 키만 반영, 나머지는 유지
        META.favorites = Array.isArray(obj.favorites) ? obj.favorites.slice(0,8) : META.favorites;
        META.prefs = Object.assign({}, META.prefs, obj.prefs || {});
        META.last = Object.assign({}, META.last, obj.last || {});
        META.recentDests = Array.isArray(obj.recentDests) ? obj.recentDests.slice(0,6) : META.recentDests;
        writeMeta(META);
        applyPersonalization();
        buildSettingsStops();
        if (isArrivals) refreshAll();
        alert('설정을 적용했어요.');
      } catch (e) {
        alert('JSON 형식이 올바르지 않습니다.');
      }
    });
  }
}

async function start() {
  readWriteMeta(true);
  DATA = await loadData();
  // 기존 즐겨찾기(정류장 이름)를 건물 이름으로 변환
  if (HAS_SAVED_META && META.favorites.length) {
    const buildingSet = new Set((DATA?.places?.buildings || []).map(b => b.name));
    META.favorites = META.favorites.map(name => {
      // 이미 건물명으로 존재하면 그대로 유지
      if (buildingSet.has(name)) return name;
      // 아니면 정류장명일 수 있으므로 역매핑
      return getBuildingForStop(DATA, name);
    });
    writeMeta(META);
  }
  initShell();
  // 정적 메타/설정 파일에서 기본값을 먼저 적용
  await loadAndApplyMetaConfig();
  loadFromURL();
  initSelectors();
  if (isArrivals) setInterval(refreshAll, 60 * 1000);
  buildSettingsStops();
  applyPersonalization();
  applyDefaultsAndLastUsed();
  initQAToggles();
  initBackupRestore();
  if ($settingsSearch) {
    $settingsSearch.addEventListener('input', () => buildSettingsStops());
  }
}

start();
