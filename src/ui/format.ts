// 表示用のフォーマット

/** 円 → 「123.4万円」 */
export function man(yen: number, digits = 1): string {
  const v = yen / 10_000;
  return `${v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits })}万円`;
}

/** 符号付き「+12.3万円」 */
export function manSigned(yen: number, digits = 1): string {
  const s = man(Math.abs(yen), digits);
  if (Math.abs(yen) < 0.5 * 10 ** (4 - digits)) return `±${s}`;
  return yen > 0 ? `+${s}` : `−${s}`;
}

export function pctSigned(rate: number, digits = 1): string {
  const v = (rate * 100).toFixed(digits);
  if (Number(v) === 0) return `±${Math.abs(Number(v)).toFixed(digits)}%`;
  return rate > 0 ? `+${v}%` : `−${Math.abs(Number(v)).toFixed(digits)}%`;
}

/** 経過月 → 「3年目 5月」 */
export function monthLabel(month: number): string {
  return `${Math.floor(month / 12) + 1}年目 ${(month % 12) + 1}月`;
}

export function signClass(v: number): string {
  return v > 0 ? 'plus' : v < 0 ? 'minus' : '';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
