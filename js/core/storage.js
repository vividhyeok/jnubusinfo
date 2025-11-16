// Local storage for META (with compact storage support)
const META_KEY = 'jnubus.meta.v1';

// Compact encoding schema (C1): shorter keys to reduce storage size
// Top-level: favorites(f), prefs(p), last(l), recentDests(r)
// prefs: defaultTab(dt), defaultDirectionId(dd), pinFavoritesOnTop(pf), showSoonOnlyMinutes(sm), maxSummaryCount(ms)
// themeColor(tc)
// last: directionId(d), start(s), end(e)

function toCompact(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const p = meta.prefs || {};
  const l = meta.last || {};
  return {
    f: Array.isArray(meta.favorites) ? meta.favorites : [],
    p: {
      dt: p.defaultTab ?? 'arrivals',
      dd: p.defaultDirectionId ?? null,
      pf: p.pinFavoritesOnTop !== false,
      sm: p.showSoonOnlyMinutes ?? 0,
      ms: p.maxSummaryCount ?? 0,
      tc: p.themeColor || '#007bff'
    },
    l: {
      d: l.directionId ?? null,
      s: l.start ?? '',
      e: l.end ?? '',
    },
    r: Array.isArray(meta.recentDests) ? meta.recentDests : [],
  };
}

function fromCompact(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    favorites: Array.isArray(c.f) ? c.f : [],
    prefs: {
      defaultTab: c.p?.dt ?? 'arrivals',
      defaultDirectionId: c.p?.dd ?? null,
      pinFavoritesOnTop: c.p?.pf !== false,
      showSoonOnlyMinutes: c.p?.sm ?? 0,
      maxSummaryCount: c.p?.ms ?? 0,
      themeColor: c.p?.tc || '#007bff'
    },
    last: {
      directionId: c.l?.d ?? null,
      start: c.l?.s ?? '',
      end: c.l?.e ?? '',
    },
    recentDests: Array.isArray(c.r) ? c.r : [],
  };
}

export function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    // Legacy JSON format starts with '{'
    if (raw.trim().startsWith('{')) {
      return JSON.parse(raw);
    }
    // C1:<json>
    if (raw.startsWith('C1:')) {
      const body = raw.slice(3);
      const compact = JSON.parse(body);
      return fromCompact(compact);
    }
    // Unknown format – try JSON as fallback
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeMeta(meta) {
  try {
    const compact = toCompact(meta);
    const payload = compact ? 'C1:' + JSON.stringify(compact) : JSON.stringify(meta);
    localStorage.setItem(META_KEY, payload);
  } catch {}
}
