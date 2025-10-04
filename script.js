// ===== 유틸 =====
const pad2 = n => String(n).padStart(2, "0");
const hhmmToMin = hhmm => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const minToHHMM = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const nowMinutesLocal = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// ===== 전역 상태 =====
let DATA = null;
let isArrivals = window.location.pathname.includes('arrivals.html');
let isRoute = window.location.pathname.includes('route.html');
let isSetting = window.location.pathname.includes('setting.html');
let isHome = window.location.pathname.endsWith('/index.html') || /\/$/.test(window.location.pathname);
let currentTab = (window.location.pathname.includes('route.html')) ? 'route' : 'arrivals'; // 기본 탭을 현재 페이지에 맞춤
let timetableMode = 'compact'; // arrivals: 'compact' | 'table'

const $direction = isArrivals ? document.getElementById("direction-select") : null;
const $refresh = isArrivals ? document.getElementById("refresh-btn") : null;
const $refreshNow = isArrivals ? document.getElementById("refresh-now") : null;
const $toggle = isArrivals ? document.getElementById("toggle-timetable") : null;
const $startBuilding = isRoute ? document.getElementById("start-building") : null;
const $endBuilding = isRoute ? document.getElementById("end-building") : null;
const $startSuggestions = isRoute ? document.getElementById("start-suggestions") : null;
const $endSuggestions = isRoute ? document.getElementById("end-suggestions") : null;
const $routeResult = isRoute ? document.getElementById("route-result") : null;
const $nowText = isArrivals ? document.getElementById("now-text") : null;
const $next = isArrivals ? document.getElementById("next-arrivals") : null;
const $table = isArrivals ? document.getElementById("timetable") : null;
// 공통 네비 요소
const $drawer = document.getElementById('drawer');
const $menuBtn = document.getElementById('menu-btn');
const $drawerBackdrop = document.getElementById('drawer-backdrop');
// 개인화/공유 UI
const $settingsBtn = document.getElementById('settings-btn');
const $settingsModal = document.getElementById('settings-modal');
const $settingsBackdrop = document.getElementById('settings-backdrop');
const $settingsSave = document.getElementById('settings-save');
const $settingsCancel = document.getElementById('settings-cancel');
const $settingsStops = document.getElementById('settings-stops');
const $settingsDefaults = document.getElementById('settings-default-stops');
const $settingsMaxSummary = document.getElementById('settings-max-summary');
const $pinnedDefaults = document.getElementById('pinned-defaults');
const $recentDests = document.getElementById('recent-dests');
// 공유 기능 제거로 관련 참조 제외

// 개인화 메타(로컬 저장)
const META_KEY = 'jnubus.meta.v1';
let META = {
  favorites: [],
  prefs: {
    defaultTab: 'arrivals', // home에서 열 때 이동
    defaultDirectionId: null,
    pinFavoritesOnTop: true,
    showSoonOnlyMinutes: 0,
    maxSummaryCount: 0 // 0=제한 없음
  },
  defaultStops: [], // 최상단 고정용 최대 2개
  last: {
    directionId: null,
    start: '',
    end: '',
  },
  recentDests: [] // 경로 탭 최근 목적지 목록 (최대 6개)
};
let focusStop = null; // 해시로 전달된 포커스 정류장

// 탭 관련 변수 (현재는 사용되지 않음)
const $tabs = [];
const $tabContents = [];

async function loadData() {
  try {
    const response = await fetch('data/data.json');
    DATA = await response.json();
    const placesResponse = await fetch('data/places.json');
    DATA.places = await placesResponse.json();
    console.log('Data loaded:', DATA);
  } catch (error) {
    console.error('Failed to load data:', error);
  }
}

// 데이터 로드 후 초기화
loadData().then(() => {
  initSelectors();
  loadFromURL();
  if (isArrivals) {
    // 60초마다 자동 갱신
    setInterval(refreshAll, 60 * 1000);
  }
  initShell();
  registerSW();
  initPersonalization();
  applyPersonalization();
  if (isSetting) {
    // 설정 페이지는 즉시 목록 구성
    if (DATA) buildSettingsStops();
  }
  applyDefaultsAndLastUsed();
  initOfflineBanner();
});

function initSelectors() {
  if (isArrivals) {
    $direction.innerHTML = DATA.routes
      .map(r => `<option value="${r.directionId}">${r.route}</option>`).join("");
    $refresh.addEventListener("click", refreshAll);
    $refreshNow.addEventListener("click", () => {
      renderNow();
      const dir = getDirection();
      renderNext(dir);
      renderTimetable(dir);
    });
    $direction.addEventListener("change", () => {
      if (!META.last) META.last = {};
      META.last.directionId = $direction.value;
      writeMeta();
      refreshAll(); updateURL();
    });
    $toggle.addEventListener("click", () => {
      timetableMode = (timetableMode === 'compact') ? 'table' : 'compact';
      const dir = getDirection();
      renderTimetable(dir);
      $toggle.textContent = (timetableMode === 'compact') ? '표로 보기' : '요약으로 보기';
    });
  } else if (isRoute) {
    if ($startBuilding) {
      $startBuilding.addEventListener("input", () => updateSuggestions($startBuilding, $startSuggestions));
      $startBuilding.addEventListener("change", () => { META.last.start = $startBuilding.value || ''; writeMeta(); });
      $startBuilding.addEventListener("blur", () => { META.last.start = $startBuilding.value || ''; writeMeta(); });
    }
    if ($endBuilding) {
      $endBuilding.addEventListener("input", () => updateSuggestions($endBuilding, $endSuggestions));
      $endBuilding.addEventListener("change", () => { META.last.end = $endBuilding.value || ''; writeMeta(); });
      $endBuilding.addEventListener("blur", () => { META.last.end = $endBuilding.value || ''; writeMeta(); });
    }
  }
}

function initShell() {
  // 드로어 토글
  if ($menuBtn && $drawer && $drawerBackdrop) {
    const closeDrawer = () => $drawer.classList.remove('open');
    $menuBtn.addEventListener('click', () => $drawer.classList.toggle('open'));
    $drawerBackdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }

  // 하단 내비 활성 표시
  const path = window.location.pathname;
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });

  // 스와이프 네비: 도착 <-> 경로 간 전환
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length) touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : touchStartX;
    const dx = endX - touchStartX;
    const threshold = 60; // px
    if (Math.abs(dx) > threshold) {
      if (dx < 0) {
        // left swipe -> 다음 탭(경로)
        if (path.endsWith('/arrivals.html')) window.location.href = 'route.html';
      } else {
        // right swipe -> 이전 탭(도착)
        if (path.endsWith('/route.html')) window.location.href = 'arrivals.html';
      }
    }
  }, { passive: true });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) META = JSON.parse(raw);
  } catch {}
}
function writeMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch {}
}

function initPersonalization() {
  readMeta();
  // 설정 버튼/모달
  const open = () => $settingsModal && $settingsModal.classList.add('open');
  const close = () => $settingsModal && $settingsModal.classList.remove('open');
  if ($settingsBtn && !isSetting) $settingsBtn.addEventListener('click', () => {
    buildSettingsStops();
    open();
  });
  if ($settingsBackdrop) $settingsBackdrop.addEventListener('click', close);
  if ($settingsCancel) $settingsCancel.addEventListener('click', () => { if (isSetting) window.history.back(); else close(); });
  if ($settingsSave) $settingsSave.addEventListener('click', () => {
    const selected = Array.from($settingsStops.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    META.favorites = Array.from(new Set(selected)).slice(0, 8); // 최대 8개
    // 기본 정류장 수집
    if ($settingsDefaults) {
      const selDefaults = Array.from($settingsDefaults.querySelectorAll('input[type="checkbox"]:checked')).map(i=>i.value);
      META.defaultStops = Array.from(new Set(selDefaults)).slice(0, 2);
    }
    // 요약 개수
    if ($settingsMaxSummary) {
      const n = parseInt($settingsMaxSummary.value || '0', 10);
      META.prefs.maxSummaryCount = isNaN(n) ? 0 : Math.max(0, Math.min(50, n));
    }
    writeMeta();
    applyPersonalization();
    if (isSetting) window.history.back(); else close();
  });

  // 공유 기능 제거
}

function buildSettingsStops() {
  if (!$settingsStops || !DATA) return;
  const allStops = Array.from(new Set(DATA.routes.flatMap(r => Object.keys(r.stops))));
  allStops.sort((a,b)=>a.localeCompare(b,'ko'));
  $settingsStops.innerHTML = allStops.map(name => {
    const checked = META.favorites.includes(name) ? 'checked' : '';
    return `<label class="item"><input type="checkbox" value="${name}" ${checked}> <span>${name}</span><span class="drag-handle" title="순서 변경">≡</span></label>`;
  }).join('');
  // 기본 정류장 체크박스
  if ($settingsDefaults) {
    $settingsDefaults.innerHTML = allStops.map(name => {
      const checked = META.defaultStops?.includes(name) ? 'checked' : '';
      return `<label class="item"><input type="checkbox" value="${name}" ${checked}> <span>${name}</span></label>`;
    }).join('');
  }
  if ($settingsMaxSummary) {
    $settingsMaxSummary.value = META.prefs?.maxSummaryCount || 0;
  }
  enableFavoritesDrag($settingsStops);
}

function enableFavoritesDrag(container) {
  if (!container) return;
  let dragging = null;
  container.querySelectorAll('.item').forEach(item => {
    // 전체 항목이 아닌 핸들에서만 드래그 시작
    const handle = item.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => { item.draggable = true; });
      handle.addEventListener('mouseup', () => { item.draggable = false; });
      handle.addEventListener('touchstart', () => { item.draggable = true; }, { passive: true });
      handle.addEventListener('touchend', () => { item.draggable = false; }, { passive: true });
    }
    item.addEventListener('dragstart', (e) => { dragging = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragging = null; item.draggable = false; saveOrder(); });
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragging) return;
    const after = getDragAfterElement(container, e.clientY);
    if (after == null) {
      container.appendChild(dragging);
    } else {
      container.insertBefore(dragging, after);
    }
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
    writeMeta();
    applyPersonalization();
  }
}

function applyPersonalization() {
  // 즐겨찾기 칩 바
  if ($favorites) {
    if (META.favorites?.length) {
      $favorites.innerHTML = META.favorites.map(n => `<button class="chip favorite" data-stop="${n}">${n}</button>`).join('');
      $favorites.querySelectorAll('button[data-stop]').forEach(btn => {
        btn.addEventListener('click', () => onFavoriteClick(btn.dataset.stop));
      });
    } else {
      $favorites.innerHTML = '';
    }
  }
  // 경로: 최근 목적지 칩
  if ($recentDests) {
    const list = (META.recentDests || []).slice(0, 6);
    $recentDests.innerHTML = list.map(n => `<button class="chip" data-dest="${n}">${n}</button>`).join('');
    $recentDests.querySelectorAll('button[data-dest]').forEach(btn => {
      btn.addEventListener('click', () => {
        if ($endBuilding) $endBuilding.value = btn.dataset.dest;
        calculateRoute();
        updateURL();
      });
    });
  }
}

function onFavoriteClick(stopName) {
  if (isArrivals) {
    // 해당 정류장 카드를 최상단 근처로 스크롤
    const card = Array.from(document.querySelectorAll('.highlight-card .stop')).find(el => el.textContent === stopName);
    if (card) card.closest('.highlight-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (isRoute) {
    // 빈 입력을 우선 채우기 → 둘 다 비었으면 출발 먼저
    if ($startBuilding && !$startBuilding.value) { $startBuilding.value = stopName; calculateRoute(); updateURL(); return; }
    if ($endBuilding && !$endBuilding.value) { $endBuilding.value = stopName; calculateRoute(); updateURL(); return; }
    // 둘 다 차 있으면 출발 교체
    if ($startBuilding) { $startBuilding.value = stopName; calculateRoute(); updateURL(); }
  }
}

// 공유 URL 생성 기능 제거

function getService() {
  // services가 없으니 기본 weekday로 가정
  return { id: "WEEKDAY", startHHMM: "08:00", endHHMM: "19:00", headwayMin: 20 };
}
function getDirection() {
  return DATA.routes.find(r => r.directionId === $direction.value) || DATA.routes[0];
}
function getRoute(directionId) {
  return DATA.routes.find(r => r.directionId === directionId);
}

// ===== 로직: 배차/휴무 반영한 출발 리스트 생성(정문 기준) =====
function generateDepartures(service) {
  const start = hhmmToMin(service.startHHMM);
  const end = hhmmToMin(service.endHHMM);
  const head = service.headwayMin;
  const breaks = service.breaks || [];

  const inBreaks = (t) => breaks.some(b => {
    const s = hhmmToMin(b.start);
    const e = hhmmToMin(b.end);
    return t >= s && t < e;
  });

  const out = [];
  for (let t = start; t <= end; t += head) {
    if (!inBreaks(t)) out.push(t);
  }
  return out; // 분 단위
}

function matchesProfile(profile, directionId) {
  return profile.directionId === directionId;
}

function generateDeparturesAllProfiles(profiles, directionId) {
  const matchingProfiles = profiles.filter(p => matchesProfile(p, directionId));
  return matchingProfiles.map(p => generateDepartures(p)).flat().sort((a,b)=>a-b);
}

// ===== 로직: 테이블/ETA 생성 =====
function getTomorrowFirstDeparture(service) {
  const firstHHMM = service.startHHMM;
  const [h, m] = firstHHMM.split(":").map(Number);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h, m, 0, 0);
  return {
    date: tomorrow.toLocaleDateString(),
    time: minToHHMM(tomorrow.getHours() * 60 + tomorrow.getMinutes()),
    minutes: tomorrow.getHours() * 60 + tomorrow.getMinutes()
  };
}

function buildTimetableAdvanced(direction) {
  const route = getRoute(direction.directionId);
  const rows = Object.keys(route.stops).map(stopName => {
    const times = route.stops[stopName].map(hhmm => hhmmToMin(hhmm));
    return { stop: stopName, times };
  });
  return rows;
}

function computeNextArrivalsAdvanced(direction, nowMin) {
  const rows = buildTimetableAdvanced(direction);
  return rows.map(r => {
    const times = r.times.filter(t => t >= nowMin);
    const current = times[0];
    const next = times[1];
    const isLast = times.length === 1; // 마지막 차
    return {
      stop: r.stop,
      current: current ? { time: minToHHMM(current), eta: current - nowMin } : null,
      next: next ? { time: minToHHMM(next), eta: next - nowMin } : null,
      isLast
    };
  });
}

// ===== 렌더링 =====
function renderNow() {
  const d = new Date();
  $nowText.textContent = `현재 시각 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function renderNext(direction) {
  const nowMin = nowMinutesLocal();
  let list = computeNextArrivalsAdvanced(direction, nowMin);
  // 즐겨찾기 우선
  const favSet = new Set(META.prefs?.pinFavoritesOnTop !== false ? META.favorites : []);
  if (favSet.size) {
    list.sort((a,b)=> (favSet.has(a.stop)?0:1) - (favSet.has(b.stop)?0:1));
  }
  // 앞으로 N분 이내만 보기
  const soonN = META.prefs?.showSoonOnlyMinutes || 0;
  if (soonN > 0) list = list.filter(it => it.current && it.current.eta <= soonN);

  // 내 기본 정류장 고정 섹션
  if ($pinnedDefaults && META.defaultStops && META.defaultStops.length) {
    const pinned = META.defaultStops
      .map(name => list.find(it => it.stop === name))
      .filter(Boolean);
    $pinnedDefaults.innerHTML = '';
    pinned.forEach(item => {
      const div = document.createElement('div');
      div.className = 'highlight-card';
      const eta = item.current ? item.current.eta : null;
      let etaClass = 'eta-later';
      if (eta !== null) {
        if (eta <= 2) etaClass = 'eta-soon';
        else if (eta <= 7) etaClass = 'eta-near';
      }
      const spanWidth = eta !== null ? Math.max(0, Math.min(100, (12 - eta) / 12 * 100)) : 0;
      const etaBadge = item.current ? `<span class="eta-badge ${etaClass}">${eta === 0 ? '곧 도착' : eta + '분'}</span>` : `<span class="chip">운행 없음</span>`;
      const nextText = item.next ? `<div class="sub">다음 ${item.next.time} (${item.next.eta}분)</div>` : `<div class="sub">다음 없음</div>`;
      div.innerHTML = `
        <div class="left">
          <div class="stop">${item.stop}</div>
          <div class="time">${item.current ? item.current.time : '-'}</div>
          ${nextText}
          <div class="meter"><span style="width:${spanWidth}%"></span></div>
        </div>
        <div class="right">${etaBadge}</div>`;
      $pinnedDefaults.appendChild(div);
    });
  }

  // 최대 요약 개수 제한
  const maxN = META.prefs?.maxSummaryCount || 0;
  if (maxN > 0) list = list.filter(it => !META.defaultStops?.includes(it.stop)).slice(0, Math.max(0, maxN));

  $next.innerHTML = ""; // reset
  list.forEach(item => {
    const div = document.createElement("div");
    div.className = "highlight-card";
    // ETA 배지 색 결정
    const eta = item.current ? item.current.eta : null;
    let etaClass = 'eta-later';
    if (eta !== null) {
      if (eta <= 2) etaClass = 'eta-soon';
      else if (eta <= 7) etaClass = 'eta-near';
    }
    const spanWidth = eta !== null ? Math.max(0, Math.min(100, (12 - eta) / 12 * 100)) : 0;
    const chips = item.isLast && item.current ? `<div class="chips"><span class="chip">막차</span></div>` : '';
    const etaBadge = item.current ? `<span class="eta-badge ${etaClass}">${eta === 0 ? '곧 도착' : eta + '분'}</span>` : `<span class="chip">운행 없음</span>`;
    const nextText = item.next ? `<div class="sub">다음 ${item.next.time} (${item.next.eta}분)</div>` : `<div class="sub">다음 없음</div>`;
    div.innerHTML = `
      <div class="left">
        <div class="stop">${item.stop}</div>
        <div class="time">${item.current ? item.current.time : '-'}</div>
        ${chips}
        ${nextText}
        <div class="meter"><span style="width:${spanWidth}%"></span></div>
      </div>
      <div class="right">${etaBadge}</div>
    `;
    $next.appendChild(div);
  });
  if (focusStop) {
    const el = Array.from(document.querySelectorAll('.highlight-card .stop')).find(e=>e.textContent===focusStop);
    if (el) el.closest('.highlight-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusStop = null;
  }
}

function renderTable(direction) {
  const rows = buildTimetableAdvanced(direction);
  // 열 헤더 만들기: 모든 시간 합집합
  const allTimes = Array.from(new Set(rows.flatMap(r => r.times))).sort((a,b)=>a-b);

  const table = document.createElement("table");

  // thead
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  let th = document.createElement("th");
  th.textContent = "정류장";
  trh.appendChild(th);
  allTimes.forEach(t => {
    const tht = document.createElement("th");
    tht.textContent = minToHHMM(t);
    trh.appendChild(tht);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  // tbody
  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    const ths = document.createElement("th");
    ths.textContent = r.stop;
    tr.appendChild(ths);
    allTimes.forEach(t => {
      const td = document.createElement("td");
      td.textContent = r.times.includes(t) ? "●" : "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  $table.innerHTML = "";
  $table.appendChild(table);
}

function renderCompactTimetable(direction) {
  const nowMin = nowMinutesLocal();
  const route = getRoute(direction.directionId);
  const container = document.createElement('div');
  container.className = 'stop-list';

  let stopNames = Object.keys(route.stops);
  const favSet = new Set(META.prefs?.pinFavoritesOnTop !== false ? META.favorites : []);
  stopNames.sort((a,b)=> (favSet.has(a)?0:1) - (favSet.has(b)?0:1) || a.localeCompare(b,'ko'));

  stopNames.forEach(stopName => {
    const times = route.stops[stopName].map(h => hhmmToMin(h)).sort((a,b)=>a-b);
    let upcoming = times.filter(t => t >= nowMin);
    const soonN = META.prefs?.showSoonOnlyMinutes || 0;
    if (soonN > 0) upcoming = upcoming.filter(t => (t - nowMin) <= soonN);
    const next3 = upcoming.slice(0, 3);

    const card = document.createElement('div');
    card.className = 'stop-card';
    const chips = next3.map(t => `<span class="chip">${minToHHMM(t)}</span>`).join('');
    const moreCount = Math.max(0, upcoming.length - next3.length);

    // 상세 영역: 모든 시간 표시(시간대 레이블 포함)
    let lastHour = null;
    const allChips = times.map(t => {
      const h = Math.floor(t/60);
      const label = (h !== lastHour) ? `<div class="hour-label">${pad2(h)}시</div>` : '';
      lastHour = h;
      return `${label}<span class="time-chip">${minToHHMM(t)}</span>`;
    }).join('');

    card.innerHTML = `
      <div class="header">
        <div class="title">${stopName}</div>
        <div class="next-chips">${chips || '<span class="chip">운행 없음</span>'}${moreCount ? `<span class="chip muted">+${moreCount}</span>` : ''}</div>
      </div>
      <details>
        <summary>전체 보기</summary>
        <div class="all-times">${allChips}</div>
      </details>
    `;
    container.appendChild(card);
  });

  $table.innerHTML = '';
  $table.appendChild(container);
}

function renderTimetable(direction) {
  if (timetableMode === 'compact') return renderCompactTimetable(direction);
  return renderTable(direction);
}

// 중복 정의 제거: 아래쪽의 updateURL/loadFromURL를 사용합니다.

function getStop(name) {
  return DATA.buildings[name] || name;
}

function updateSuggestions(input, suggestionsDiv) {
  const query = input.value;
  const filtered = filterLocations(query);
  suggestionsDiv.innerHTML = '';
  if (filtered.length > 0) {
    filtered.forEach(location => {
      const div = document.createElement('div');
      div.textContent = location;
      div.onclick = () => {
        input.value = location;
        suggestionsDiv.style.display = 'none';
        calculateRoute();
        updateURL();
      };
      suggestionsDiv.appendChild(div);
    });
    suggestionsDiv.style.display = 'block';
  } else {
    suggestionsDiv.style.display = 'none';
  }
}

function getChosung(str) {
  const chosung = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const chosungIndex = Math.floor(offset / 588);
      result += chosung[chosungIndex];
    } else {
      result += str[i];
    }
  }
  return result;
}

function filterLocations(query) {
  if (!query) return [];
  const queryLower = query.toLowerCase();
  const queryChosung = getChosung(queryLower);
  const buildings = DATA.places ? DATA.places.buildings.filter(building => {
    const name = building.name.toLowerCase();
    const nameChosung = getChosung(name);
    return name.includes(queryLower) || nameChosung.startsWith(queryChosung);
  }).map(b => b.name) : [];
  const stops = Object.keys(DATA.routes[0].stops).filter(stop => {
    const name = stop.toLowerCase();
    const nameChosung = getChosung(name);
    return name.includes(queryLower) || nameChosung.startsWith(queryChosung);
  });
  return [...buildings, ...stops];
}

function calculateRoute() {
  const startName = getStop($startBuilding.value);
  const endName = getStop($endBuilding.value);
  if (!startName || !endName || startName === endName) {
    $routeResult.innerHTML = "";
    return;
  }

  // 방향 결정: 출발과 도착이 같은 방향에 있는지 확인
  let route = null;
  for (const r of DATA.routes) {
    if (r.stops[startName] && r.stops[endName]) {
      route = r;
      break;
    }
  }
  if (!route) {
    $routeResult.innerHTML = "<p>해당 경로는 지원되지 않습니다.</p>";
    return;
  }

  const startTimes = route.stops[startName];
  const endTimes = route.stops[endName];
  const endStop = route.stops[endName];

  const nowMin = nowMinutesLocal();
  const startArrivals = startTimes.map(hhmm => hhmmToMin(hhmm));
  const endArrivals = endStop.map(hhmm => hhmmToMin(hhmm));

  const nextStart = startArrivals.find(t => t >= nowMin);
  if (!nextStart) {
    const lastTime = Math.max(...startArrivals);
    const remaining = lastTime - nowMin;
    const hours = Math.floor(remaining / 60);
    const mins = remaining % 60;
    $routeResult.innerHTML = `
  <p>금일 JENBI 기준 운행은 마감됐습니다.</p>
      <p><strong>마지막 차:</strong> ${minToHHMM(lastTime)}</p>
      <p><strong>남은 시간:</strong> ${hours}시간 ${mins}분</p>
    `;
    return;
  }

  // 다음 출발 시간에 해당하는 도착 시간 찾기
  const startIndex = startArrivals.indexOf(nextStart);
  const arrivalTime = endArrivals[startIndex];
  const travelTime = Math.abs(arrivalTime - nextStart);
  const waitTime = nextStart - nowMin;

  $routeResult.innerHTML = `
    <div class="route-card">
      <div class="route-header">
        <div class="title">경로 안내</div>
        <div class="chips">
          <span class="chip">${route.route}</span>
          <span class="chip">${route.directionId}</span>
        </div>
      </div>
      <div class="timeline">
        <div class="node">
          <div class="dot"></div>
          <div class="content">
            <div class="label">출발</div>
            <div class="place">${startName}</div>
            <div class="time">${minToHHMM(nextStart)} <span class="eta-badge ${waitTime <= 2 ? 'eta-soon' : (waitTime <= 7 ? 'eta-near' : 'eta-later')}">${waitTime === 0 ? '곧' : waitTime + '분 후'}</span></div>
          </div>
        </div>
        <div class="connector">
          <div class="line"></div>
          <div class="bus">버스 이동 ${travelTime}분</div>
        </div>
        <div class="node">
          <div class="dot"></div>
          <div class="content">
            <div class="label">도착</div>
            <div class="place">${endName}</div>
            <div class="time">${minToHHMM(arrivalTime)} 도착 예정</div>
          </div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>대기</span><strong>${waitTime}분</strong></div>
        <div class="stat"><span>이동</span><strong>${travelTime}분</strong></div>
        <div class="stat"><span>총 소요</span><strong>${waitTime + travelTime}분</strong></div>
      </div>
    </div>
  `;
  // 최근 목적지 누적
  if (!META.recentDests) META.recentDests = [];
  if (endName) {
    META.recentDests = [endName, ...META.recentDests.filter(n => n !== endName)].slice(0, 6);
    writeMeta();
    applyPersonalization();
  }
  updateURL();
}

function refreshAll() {
  if (isArrivals) {
    renderNow();
    const dir = getDirection();
    renderNext(dir);
    renderTimetable(dir);
    if ($toggle) $toggle.textContent = (timetableMode === 'compact') ? '표로 보기' : '요약으로 보기';
  } else if (isRoute) {
    calculateRoute();
  }
}

function switchTab(tabId) {
  currentTab = tabId;
  // 탭 전환 로직이 필요 없음 (현재 페이지 구조상)
}

function updateURL() {
  const params = new URLSearchParams();
  params.set('tab', currentTab);
  if (currentTab === 'arrivals') {
    params.set('direction', $direction.value);
  } else if (currentTab === 'route') {
    if ($startBuilding.value) params.set('start', $startBuilding.value);
    if ($endBuilding.value) params.set('end', $endBuilding.value);
  }
  history.replaceState(null, '', '?' + params.toString());
  // 마지막 사용값 저장
  if (currentTab === 'arrivals' && $direction) {
    if (!META.last) META.last = {};
    META.last.directionId = $direction.value;
  } else if (currentTab === 'route') {
    if (!META.last) META.last = {};
    META.last.start = $startBuilding?.value || '';
    META.last.end = $endBuilding?.value || '';
  }
  writeMeta();
}

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') || 'arrivals';
  switchTab(tab);
  if (tab === 'arrivals') {
    const direction = params.get('direction');
    if (direction) $direction.value = direction;
  } else if (tab === 'route') {
    const start = params.get('start');
    const end = params.get('end');
    if (start && $startBuilding) $startBuilding.value = start;
    if (end && $endBuilding) $endBuilding.value = end;
  }
  // 해시로 전달된 즐겨찾기(f=...) 반영
  if (window.location.hash) {
    const m = /f=([^&]+)/.exec(window.location.hash);
    if (m && m[1]) {
      const favs = decodeURIComponent(m[1]).split(',').filter(Boolean);
      if (favs.length) {
        META.favorites = Array.from(new Set(favs)).slice(0, 8);
        writeMeta();
      }
    }
    const fs = /fs=([^&]+)/.exec(window.location.hash);
    if (fs && fs[1]) focusStop = decodeURIComponent(fs[1]);
  }
}

function applyDefaultsAndLastUsed() {
  // 홈: 기본 시작 화면으로 리다이렉트
  if (isHome && META.prefs?.defaultTab) {
    if (META.prefs.defaultTab === 'arrivals') { window.location.href = 'arrivals.html'; return; }
    if (META.prefs.defaultTab === 'route') { window.location.href = 'route.html'; return; }
  }
  // 도착: 기본/마지막 방향 적용 후 렌더
  if (isArrivals && $direction && DATA) {
    const pref = META.prefs?.defaultDirectionId || META.last?.directionId;
    if (pref && DATA.routes.some(r=>r.directionId===pref)) $direction.value = pref;
    refreshAll();
  }
  // 경로: 마지막 입력 복원
  if (isRoute && $startBuilding && $endBuilding) {
    if (META.last?.start) $startBuilding.value = META.last.start;
    if (META.last?.end) $endBuilding.value = META.last.end;
    if ($startBuilding.value && $endBuilding.value) calculateRoute();
  }
}

function initOfflineBanner() {
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
