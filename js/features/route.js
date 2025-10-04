import { hhmmToMin, minToHHMM, nowMinutesLocal } from '../core/utils.js';
import { getStop } from './data.js';

export function calculateRoute(DATA, $routeResult, startValue, endValue) {
  const startName = getStop(DATA, startValue);
  const endName = getStop(DATA, endValue);
  if (!startName || !endName) {
    $routeResult.innerHTML = '';
    return { startName, endName, ok: false };
  }
  // 동일 정류장으로 매핑되면 도보 권장을 안내
  if (startName === endName) {
    $routeResult.innerHTML = `
      <div class="route-card">
        <div class="route-header">
          <div class="title">안내</div>
          <div class="chips">
            <span class="chip">도보 권장</span>
            <span class="chip">같은 정류장</span>
          </div>
        </div>
        <div class="timeline">
          <div class="node">
            <div class="dot"></div>
            <div class="content">
              <div class="label">가까운 정류장</div>
              <div class="place">${startName}</div>
            </div>
          </div>
          <div class="connector">
            <div class="line"></div>
            <div class="bus">두 입력 건물의 가장 가까운 정류장이 동일합니다.</div>
          </div>
          <div class="node">
            <div class="dot"></div>
            <div class="content">
              <div class="label">권장사항</div>
              <div class="place">가까운 거리라면 걸어가시는 편을 추천드립니다.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    return { startName, endName, ok: false, sameStop: true };
  }
  // NOTE: getStop은 places.json과 place-to-stop.json의 매핑을 우선 사용합니다.
  // 매핑이 없다면 입력 문자열 그대로를 정류장 이름으로 취급합니다.

  // 후보 경로 계산: A/B 등 모든 노선 중 시작/도착 둘 다 포함하는 노선만 고려
  const nowMin = nowMinutesLocal();
  const candidates = [];
  for (const r of DATA.routes) {
    const startTimes = r.stops[startName];
    const endTimes = r.stops[endName];
    if (!startTimes || !endTimes) continue;
    const startIdx = r.stopsOrder.indexOf(startName);
    const endIdx = r.stopsOrder.indexOf(endName);
    if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) continue; // 방향 고려: 시작이 도착보다 앞에 있어야 함
    const startArrivals = startTimes.map(hhmm => hhmmToMin(hhmm));
    const endArrivals = endTimes.map(hhmm => hhmmToMin(hhmm));
    const nextStart = startArrivals.find(t => t >= nowMin);
    if (!nextStart) continue; // 오늘 남은 버스 없음
    const idx = startArrivals.indexOf(nextStart);
    const arrivalTime = endArrivals[idx];
    if (typeof arrivalTime !== 'number') continue; // 방어
    const waitTime = nextStart - nowMin;
    const travelTime = Math.max(0, arrivalTime - nextStart);
    const totalTime = waitTime + travelTime;
    candidates.push({ route: r, nextStart, arrivalTime, waitTime, travelTime, totalTime });
  }

  if (candidates.length === 0) {
    // 어떤 노선도 오늘 남은 차가 없거나 출발/도착이 같은 노선에 없음
    // 마지막 차 정보라도 제공 가능한 노선이 있으면 보여줌 (가장 늦은 마지막 출발 기준)
    let lastBest = null;
    for (const r of DATA.routes) {
      const startTimes = r.stops[startName];
      const endTimes = r.stops[endName];
      if (!startTimes || !endTimes) continue;
      const startIdx = r.stopsOrder.indexOf(startName);
      const endIdx = r.stopsOrder.indexOf(endName);
      if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) continue; // 방향 고려
      const startArrivals = startTimes.map(hhmm => hhmmToMin(hhmm));
      const lastTime = Math.max(...startArrivals);
      if (!isFinite(lastTime)) continue;
      if (!lastBest || lastTime > lastBest.lastTime) lastBest = { route: r, lastTime };
    }
    if (lastBest) {
      const remaining = lastBest.lastTime - nowMin;
      const hours = Math.floor(Math.max(0, remaining) / 60);
      const mins = Math.max(0, remaining) % 60;
      $routeResult.innerHTML = `
        <p>금일 남은 운행이 없거나 해당 노선 시간대가 지났습니다.</p>
        <p><strong>마지막 차(${lastBest.route.route}):</strong> ${minToHHMM(lastBest.lastTime)}</p>
        <p><strong>남은 시간:</strong> ${hours}시간 ${mins}분</p>
      `;
    } else {
      $routeResult.innerHTML = '<p>해당 경로는 지원되지 않습니다.</p>';
    }
    return { startName, endName, ok: false };
  }

  // 총 소요시간이 짧은 순으로 정렬(동률이면 더 빨리 출발하는 순)
  candidates.sort((a, b) => a.totalTime - b.totalTime || a.nextStart - b.nextStart);
  // 상위 2개(보통 A/B)를 보여준다.
  const top = candidates.slice(0, 2);
  const cards = top.map((c, idx) => {
    const routeChipClass = /A/.test(c.route.route) ? 'chip-a' : (/B/.test(c.route.route) ? 'chip-b' : '');
    return `
    <div class="route-card">
      <div class="route-header">
        <div class="title">경로 안내${idx+1}</div>
        <div class="chips">
          <span class="chip ${routeChipClass}">${c.route.route}</span>
          <span class="chip">${c.route.directionId}</span>
          <span class="chip ${c.totalTime <= top[0].totalTime ? 'primary' : 'muted'}">총 ${c.totalTime}분</span>
        </div>
      </div>
      <div class="timeline">
        <div class="node">
          <div class="dot"></div>
          <div class="content">
            <div class="label">출발</div>
            <div class="place">${startName}</div>
            <div class="time">${minToHHMM(c.nextStart)} <span class="eta-badge ${c.waitTime <= 2 ? 'eta-soon' : (c.waitTime <= 7 ? 'eta-near' : 'eta-later')} ">${c.waitTime === 0 ? '곧' : c.waitTime + '분 후'}</span></div>
          </div>
        </div>
        <div class="connector">
          <div class="line"></div>
          <div class="bus">버스 이동 ${c.travelTime}분</div>
        </div>
        <div class="node">
          <div class="dot"></div>
          <div class="content">
            <div class="label">도착</div>
            <div class="place">${endName}</div>
            <div class="time">${minToHHMM(c.arrivalTime)} 도착 예정</div>
          </div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>대기</span><strong>${c.waitTime}분</strong></div>
        <div class="stat"><span>이동</span><strong>${c.travelTime}분</strong></div>
        <div class="stat"><span>총 소요</span><strong>${c.totalTime}분</strong></div>
      </div>
    </div>
  `;}).join('');

  // 더 빠른 것을 위에 오도록 이미 정렬됨. 전체를 출력
  $routeResult.innerHTML = `<div class="route-cards">${cards}</div>`;
  return { startName, endName, ok: true, compared: top };
}
