import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import type { LifeEvent } from '../../src/sim/events';
import { maxDrawdown, type Market } from '../../src/sim/market';
import { runSimulation, type PlayerAction } from '../../src/sim/portfolio';
import { determineTitle } from '../../src/sim/titles';

const N = CONFIG.months;
// 100か月目に底（−50%）をつけて、その後回復する値動き
const market: Market = {
  seed: 0,
  prices: Array.from({ length: N + 1 }, (_, m) => {
    if (m < 80) return 10_000;
    if (m <= 100) return 10_000 * (1 - 0.5 * ((m - 80) / 20));
    return 5_000 + 10_000 * ((m - 100) / (N - 100));
  }),
  scenarios: [],
};
const alloc = { investPerMonth: 40_000, savePerMonth: 10_000 };
const title = (actions: PlayerAction[], events: LifeEvent[] = [], a = alloc) =>
  determineTitle(runSimulation(market, a, events, actions), market).id;

describe('称号', () => {
  it('テスト用の値動きの底は100か月目', () => {
    expect(maxDrawdown(market.prices).troughMonth).toBe(100);
  });
  it('鋼の握力', () => expect(title([])).toBe('steel'));
  it('底で売る天才（±2か月）', () => {
    expect(title([{ month: 98, type: 'sell' }, { month: 120, type: 'buy' }])).toBe('bottomGenius');
    expect(title([{ month: 102, type: 'letGo' }, { month: 120, type: 'buy' }])).toBe('bottomGenius');
    expect(title([{ month: 97, type: 'sell' }, { month: 120, type: 'buy' }])).not.toBe('bottomGenius');
  });
  it('生活に負けた人（強制売却30万円以上）', () => {
    const ev: LifeEvent[] = [{ month: 20, id: 'job', name: '無収入', cost: 600_000 }];
    expect(title([], ev, { investPerMonth: 50_000, savePerMonth: 0 })).toBe('lifeLoser');
  });
  it('強制売却が少しでもあれば鋼の握力ではない', () => {
    const ev: LifeEvent[] = [{ month: 20, id: 'w', name: '結婚式', cost: 400_000 }];
    expect(title([], ev, { investPerMonth: 50_000, savePerMonth: 0 })).toBe('normal');
  });
  it('タイミングの魔術師（売却と買い戻しを3回以上）', () => {
    const acts: PlayerAction[] = [];
    for (const m of [10, 30, 50]) acts.push({ month: m, type: 'sell' }, { month: m + 5, type: 'buy' });
    expect(title(acts)).toBe('timingWizard');
  });
  it('途中下車（売って最後まで買い戻さない）', () => {
    expect(title([{ month: 50, type: 'sell' }])).toBe('getOff');
  });
  it('ふつうにえらい', () => {
    expect(title([{ month: 50, type: 'sell' }, { month: 60, type: 'buy' }])).toBe('normal');
  });
});
