import { nowMinutesLocal, hhmmToMin, minToHHMM, pad2 } from '../core/utils.js';
import { getRoute } from './data.js';

export function buildTimetableAdvanced(DATA, direction) {
  const route = getRoute(DATA, direction.directionId);
  const rows = Object.keys(route.stops).map(stopName => {
    const times = route.stops[stopName].map(hhmm => hhmmToMin(hhmm));
    return { stop: stopName, times };
  });
  return rows;
}

export function computeNextArrivalsAdvanced(DATA, direction, nowMin) {
  const rows = buildTimetableAdvanced(DATA, direction);
  return rows.map(r => {
    const times = r.times.filter(t => t >= nowMin);
    const current = times[0];
    const next = times[1];
    const isLast = times.length === 1;
    return {
      stop: r.stop,
      current: current ? { time: minToHHMM(current), eta: current - nowMin } : null,
      next: next ? { time: minToHHMM(next), eta: next - nowMin } : null,
      isLast
    };
  });
}

export function renderNow($nowText) {
  const d = new Date();
  $nowText.textContent = `현재 시각 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
