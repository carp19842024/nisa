// シード付き乱数（mulberry32）。同じシードからは常に同じ列が出る。

export type Rng = {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, max] の整数 */
  int(min: number, max: number): number;
  /** 標準正規分布 */
  normal(): number;
  /** 配列から1つ選ぶ */
  pick<T>(items: readonly T[]): T;
  /** 重み付きで1つ選ぶ */
  weighted<T extends { weight: number }>(items: readonly T[]): T;
  /** 配列をシャッフルした新しい配列を返す */
  shuffle<T>(items: readonly T[]): T[];
};

/** シードと用途番号から、独立した乱数列用のシードを作る */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (stream + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  let spareNormal: number | null = null;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    normal() {
      if (spareNormal !== null) {
        const v = spareNormal;
        spareNormal = null;
        return v;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spareNormal = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    weighted(items) {
      const total = items.reduce((s, it) => s + it.weight, 0);
      let r = next() * total;
      for (const it of items) {
        r -= it.weight;
        if (r < 0) return it;
      }
      return items[items.length - 1];
    },
    shuffle(items) {
      const arr = items.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
  return rng;
}

/** URL などから受け取った文字列をシード（32bit 符号なし整数）にする */
export function parseSeed(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(BigInt(s) % 4294967296n);
  // 数字以外は文字列ハッシュ
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}
