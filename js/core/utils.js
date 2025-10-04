// Core utilities
export const pad2 = n => String(n).padStart(2, '0');
export const hhmmToMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const minToHHMM = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
export const nowMinutesLocal = () => { const d = window.testTime || new Date(); return d.getHours() * 60 + d.getMinutes(); };
export function normalizeBuildingName(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  // 앞자리 코드(숫자) 제거
  s = s.replace(/^\d+\s*/, '');
  // 중점 제거
  s = s.replace(/·/g, '');
  // 의과대학 1호관 표기 통일 (공백 제거)
  if (/^의과대학\s*1호관$/.test(s)) s = '의과대학1호관';
  // 노선 표기와의 차이를 흡수: 해양과학대학 4호관 -> 해양대학 4호관
  if (s === '해양과학대학 4호관') s = '해양대학 4호관';
  return s;
}

export function getChosung(str) {
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

// Returns true if every character of `needle` appears in order in `haystack` (not necessarily contiguous).
// This makes 초성 부분 검색(예: ㄱㅇ → 골프아카데미) 가능.
export function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}
