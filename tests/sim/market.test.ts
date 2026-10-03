import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import { generateMarket, maxDrawdown, priceAt } from '../../src/sim/market';
import { createRng, parseSeed } from '../../src/sim/rng';

describe('rng', () => {
  it('同じシードなら同じ乱数列になる', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('URL のシード文字列を解釈できる', () => {
    expect(parseSeed('123')).toBe(123);
    expect(parseSeed('')).toBeNull();
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed('abc')).toBe(parseSeed('abc'));
  });
});

describe('market', () => {
  it('同じシードで同じ値動きになる', () => {
    const a = generateMarket(123);
    const b = generateMarket(123);
    expect(a.prices).toEqual(b.prices);
    expect(a.scenarios).toEqual(b.scenarios);
  });

  it('違うシードなら違う値動きになる', () => {
    expect(generateMarket(1).prices).not.toEqual(generateMarket(2).prices);
  });

  it('価格は 240か月 + 1 点あり、すべて正の値', () => {
    const m = generateMarket(7);
    expect(m.prices).toHaveLength(CONFIG.months + 1);
    expect(m.prices[0]).toBe(CONFIG.market.initialPrice);
    for (const p of m.prices) expect(p).toBeGreaterThan(0);
  });

  it('暴落シナリオは 2〜3 個、ずるずる型を必ず含み、期間内で重ならない', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { scenarios } = generateMarket(seed);
      expect(scenarios.length).toBeGreaterThanOrEqual(2);
      expect(scenarios.length).toBeLessThanOrEqual(3);
      expect(scenarios.some((s) => s.id === 'zuruzuru')).toBe(true);
      expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
      for (let i = 0; i < scenarios.length; i++) {
        const s = scenarios[i];
        expect(s.startMonth).toBeGreaterThanOrEqual(CONFIG.market.earliestStartMonth);
        expect(s.endMonth).toBeLessThanOrEqual(CONFIG.months);
        if (i > 0) expect(s.startMonth).toBeGreaterThanOrEqual(scenarios[i - 1].endMonth);
      }
    }
  });

  it('ずるずる型の期間中に深い下落が起きる', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = generateMarket(seed);
      const z = m.scenarios.find((s) => s.id === 'zuruzuru')!;
      const before = m.prices[z.startMonth];
      const bottom = Math.min(...m.prices.slice(z.startMonth, z.endMonth + 1));
      expect(1 - bottom / before).toBeGreaterThan(0.3);
    }
  });

  it('priceAt は月の間を直線で補間する', () => {
    const prices = [100, 200, 50];
    expect(priceAt(prices, 0)).toBe(100);
    expect(priceAt(prices, 0.5)).toBe(150);
    expect(priceAt(prices, 1.5)).toBe(125);
    expect(priceAt(prices, 99)).toBe(50);
  });

  it('maxDrawdown は最も深い下落の底を返す', () => {
    const dd = maxDrawdown([100, 120, 90, 60, 130, 100]);
    expect(dd.peakMonth).toBe(1);
    expect(dd.troughMonth).toBe(3);
    expect(dd.maxDrawdown).toBeCloseTo(0.5);
  });
});

describe('ファンド', () => {
  it('すべてのファンドの値動きがあり、同じシードで同じになる', () => {
    const a = generateMarket(55);
    const b = generateMarket(55);
    for (const f of CONFIG.funds) {
      expect(a.funds[f.id]).toHaveLength(CONFIG.months + 1);
      expect(a.funds[f.id]).toEqual(b.funds[f.id]);
      for (const p of a.funds[f.id]!) expect(p).toBeGreaterThan(0);
    }
    expect(a.fundBusts).toEqual(b.fundBusts);
  });

  it('ぜんぶ入りファンドは市場全体の指数と同じ値動き', () => {
    const m = generateMarket(9);
    m.prices.forEach((p, i) => expect(m.funds.zenbu![i]).toBeCloseTo(p, 6));
  });

  it('ずるずる型の下落中、ロケットは市場より深く、バランスは浅く下がり、ゴールドは上がりやすい', () => {
    let rocketDeeper = 0;
    let mattariShallower = 0;
    let goldUp = 0;
    const n = 100;
    for (let seed = 1; seed <= n; seed++) {
      const m = generateMarket(seed);
      const z = m.scenarios.find((s) => s.id === 'zuruzuru')!;
      const chg = (p: number[]) => p[z.bottomMonth] / p[z.startMonth] - 1;
      const mk = chg(m.prices);
      if (chg(m.funds.rocket!) < mk) rocketDeeper++;
      if (chg(m.funds.mattari!) > mk) mattariShallower++;
      if (chg(m.funds.gold!) > 0) goldUp++;
    }
    expect(rocketDeeper / n).toBeGreaterThan(0.75);
    expect(mattariShallower / n).toBeGreaterThan(0.9);
    expect(goldUp / n).toBeGreaterThan(0.6);
  });

  it('ロケットのブーム終了は、期間内に収まる', () => {
    let count = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const b of generateMarket(seed).fundBusts) {
        count++;
        expect(b.fund).toBe('rocket');
        expect(b.bottomMonth).toBeLessThan(CONFIG.months);
      }
    }
    expect(count).toBeGreaterThan(50);
  });
});
