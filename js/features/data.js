// Data loading
import { normalizeBuildingName } from '../core/utils.js';
export async function loadData() {
  const result = { routes: [], places: null, buildings: {} };
  try {
    const res = await fetch('data/data.json');
    const data = await res.json();
    Object.assign(result, data);
    const placesRes = await fetch('data/places.json');
    result.places = await placesRes.json();
    // 선택: 학교에서 제공한 보조 매핑 파일(b.txt)을 불러와 보강합니다.
    // 형식: { bus_stops: {"정문":"100", ...}, buildings_to_nearest_stop: {"사범대학 1호관":"교양강의동", ...} }
    try {
      const bRes = await fetch('references/b.txt', { cache: 'no-store' });
      if (bRes.ok) {
        const bjson = await bRes.json();
        if (bjson.bus_stops && typeof bjson.bus_stops === 'object') {
          result.bus_stops = Object.assign({}, result.bus_stops || {}, bjson.bus_stops);
        }
        if (bjson.buildings_to_nearest_stop && typeof bjson.buildings_to_nearest_stop === 'object') {
          result.buildings = Object.assign({}, result.buildings || {}, bjson.buildings_to_nearest_stop);
        }
      }
    } catch {}
    // 선택: 외부 매핑 파일(1:1 장소→정류장)을 지원합니다.
    // 형식 예: { "사범대학 1호관": "사범대학", "본관": "본관 정류장" }
    try {
      const mapRes = await fetch('data/place-to-stop.json', { cache: 'no-store' });
      if (mapRes.ok) {
        const mapping = await mapRes.json();
        // 외부 매핑(place-to-stop.json)이 우선 적용되도록 순서를 조정합니다.
        result.buildings = Object.assign({}, result.buildings || {}, mapping);
      }
    } catch {}
    // buildings 키를 정규화하여 중복과 표기 차이를 제거합니다.
    const normalizedBuildings = {};
    for (const [k, v] of Object.entries(result.buildings)) {
      const normKey = normalizeBuildingName(k);
      const normValue = normalizeBuildingName(v);
      if (!normalizedBuildings[normKey]) normalizedBuildings[normKey] = normValue;
    }
    result.buildings = normalizedBuildings;
  } catch (e) { console.error('Failed to load data', e); }
  return result;
}

export function getRoute(DATA, directionId) { return DATA.routes.find(r => r.directionId === directionId); }

export function getStop(DATA, name) {
  // 입력된 건물명을 정규화한 뒤, 사전 매핑을 통해 정류장명으로 변환합니다.
  const key = normalizeBuildingName(name);
  return (DATA.buildings?.[key]) || key;
}
export function getBuildingForStop(DATA, stopName) {
  if (!stopName) return stopName;
  // 1) 정류장명과 동일한 건물명이 존재하면 그 이름을 우선 반환
  const hasExactBuilding = Array.isArray(DATA?.places?.buildings)
    && DATA.places.buildings.some(b => b.name === stopName);
  if (hasExactBuilding) return stopName;
  // 2) 역매핑: 정류장 → 건물 이름 (첫 번째 매칭)
  for (const [building, stop] of Object.entries(DATA.buildings || {})) {
    if (stop === stopName) return building;
  }
  // 3) 없으면 원본 반환
  return stopName;
}
