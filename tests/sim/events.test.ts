import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import { scheduleLifeEvents } from '../../src/sim/events';
import { generateMarket, isCrashMonth } from '../../src/sim/market';

describe('ライフイベント', () => {
  it('同じシードなら同じスケジュールになる', () => {
    const m = generateMarket(77);
    expect(scheduleLifeEvents(m)).toEqual(scheduleLifeEvents(generateMarket(77)));
  });

  it('最小間隔を守り、期間内に収まり、金額は config の値', () => {
    const costs = new Set(CONFIG.lifeEvents.list.map((e) => e.cost));
    for (let seed = 1; seed <= 200; seed++) {
      const ev = scheduleLifeEvents(generateMarket(seed));
      for (let i = 0; i < ev.length; i++) {
        expect(ev[i].month).toBeGreaterThanOrEqual(CONFIG.lifeEvents.earliestMonth);
        expect(ev[i].month).toBeLessThan(CONFIG.months);
        expect(costs.has(ev[i].cost)).toBe(true);
        if (i > 0) expect(ev[i].month - ev[i - 1].month).toBeGreaterThanOrEqual(CONFIG.lifeEvents.minGapMonths);
      }
    }
  });

  it('平均すると2〜4年に1回程度、暴落中に起きやすい', () => {
    let total = 0;
    let inCrash = 0;
    let crashMonths = 0;
    const n = 400;
    for (let seed = 1; seed <= n; seed++) {
      const m = generateMarket(seed);
      const ev = scheduleLifeEvents(m);
      total += ev.length;
      inCrash += ev.filter((e) => isCrashMonth(m.scenarios, e.month)).length;
      for (let mo = 0; mo < CONFIG.months; mo++) if (isCrashMonth(m.scenarios, mo)) crashMonths++;
    }
    const perYear = total / n / 20;
    expect(perYear).toBeGreaterThan(1 / 4);
    expect(perYear).toBeLessThan(1 / 2);
    // 暴落中の月の割合より、暴落中に起きたイベントの割合のほうが大きい
    expect(inCrash / total).toBeGreaterThan(crashMonths / (n * CONFIG.months));
  });
});
