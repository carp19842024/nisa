import { describe, expect, it } from 'vitest';
import type { LifeEvent } from '../../src/sim/events';
import { maxDrawdown } from '../../src/sim/market';
import { runSimulation, type Allocation, type PlayerAction } from '../../src/sim/portfolio';
import { determineTitle } from '../../src/sim/titles';
import { fixedMarket, N, zenbu } from './helpers';

// 100か月目に底（−50%）をつけて、その後回復する値動き。ゴールドは横ばい、ロケット・バランスは市場と同じ
const curve = (m: number) => {
  if (m < 80) return 10_000;
  if (m <= 100) return 10_000 * (1 - 0.5 * ((m - 80) / 20));
  return 5_000 + 10_000 * ((m - 100) / (N - 100));
};
const market = fixedMarket(curve, { gold: () => 10_000, rocket: curve, mattari: curve });
const alloc = zenbu(40_000, 10_000);

const title = (actions: PlayerAction[], events: LifeEvent[] = [], a: Allocation = alloc) => {
  const zenbuOnly = runSimulation(market, zenbu(40_000, a.savePerMonth), events, []);
  return determineTitle(runSimulation(market, a, events, actions), market, { allocation: a, zenbuOnlyTotal: zenbuOnly.totalAssets }).id;
};

describe('称号', () => {
  it('テスト用の値動きの底は100か月目', () => {
    expect(maxDrawdown(market.prices).troughMonth).toBe(100);
  });
  it('鋼の握力', () => expect(title([])).toBe('steel'));
  it('分散の達人（3本以上で一度も売らない）', () => {
    expect(title([], [], { invest: { zenbu: 20_000, gold: 10_000, mattari: 10_000 }, savePerMonth: 10_000 })).toBe('diversified');
  });
  it('底で売る天才（±2か月）', () => {
    expect(title([{ month: 98, type: 'sell' }, { month: 120, type: 'resume' }])).toBe('bottomGenius');
    expect(title([{ month: 102, type: 'letGo' }, { month: 120, type: 'resume' }])).toBe('bottomGenius');
    expect(title([{ month: 97, type: 'sell' }, { month: 120, type: 'resume' }])).not.toBe('bottomGenius');
  });
  it('生活に負けた人（強制売却30万円以上）', () => {
    const ev: LifeEvent[] = [{ month: 20, id: 'job', name: '無収入', cost: 600_000 }];
    expect(title([], ev, zenbu(50_000, 0))).toBe('lifeLoser');
  });
  it('強制売却が少しでもあれば鋼の握力ではない', () => {
    const ev: LifeEvent[] = [{ month: 20, id: 'w', name: '結婚式', cost: 400_000 }];
    expect(title([], ev, zenbu(50_000, 0))).toBe('normal');
  });
  it('ロケットに夢を見た人（ロケット中心で、ロケットを売った）', () => {
    const a: Allocation = { invest: { rocket: 30_000, zenbu: 10_000 }, savePerMonth: 10_000 };
    expect(title([{ month: 50, type: 'sell', fund: 'rocket' }, { month: 60, type: 'resume', fund: 'rocket' }], [], a)).toBe('rocketDreamer');
  });
  it('タイミングの魔術師（売却と買い直しを3回以上）', () => {
    const acts: PlayerAction[] = [];
    for (const m of [10, 30, 50]) acts.push({ month: m, type: 'sell' }, { month: m + 5, type: 'resume' });
    expect(title(acts)).toBe('timingWizard');
  });
  it('途中下車（自分で売って、最後まで1本も積立していない）', () => {
    expect(title([{ month: 50, type: 'sell' }])).toBe('getOff');
    const a: Allocation = { invest: { zenbu: 30_000, gold: 10_000 }, savePerMonth: 10_000 };
    expect(title([{ month: 50, type: 'sell', fund: 'gold' }, { month: 60, type: 'sell', fund: 'zenbu' }], [], a)).toBe('getOff');
  });
  it('1本だけ売ったまま（他は積立中）なら途中下車ではない', () => {
    const a: Allocation = { invest: { zenbu: 30_000, gold: 10_000 }, savePerMonth: 10_000 };
    expect(title([{ month: 50, type: 'sell', fund: 'gold' }], [], a)).toBe('normal');
  });
  it('振り落とされた人（握力切れで全部売り、そのまま戻らない）', () => {
    expect(title([{ month: 50, type: 'letGo' }])).toBe('shakenOff');
    // 握力切れのあと再開すれば当てはまらない
    expect(title([{ month: 50, type: 'letGo' }, { month: 60, type: 'resume' }])).toBe('normal');
  });
  it('金の亡者（ゴールド中心で、ぜんぶ入りだけより少ない）', () => {
    const a: Allocation = { invest: { gold: 30_000, zenbu: 10_000 }, savePerMonth: 10_000 };
    expect(title([{ month: 50, type: 'sell', fund: 'zenbu' }, { month: 60, type: 'resume', fund: 'zenbu' }], [], a)).toBe('goldBug');
  });
  it('ふつうにえらい', () => {
    expect(title([{ month: 50, type: 'sell' }, { month: 60, type: 'resume' }])).toBe('normal');
  });
});
