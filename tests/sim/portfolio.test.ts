import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import type { LifeEvent } from '../../src/sim/events';
import { generateMarket, type Market } from '../../src/sim/market';
import { Portfolio, runSimulation } from '../../src/sim/portfolio';
import { evaluateGame } from '../../src/sim/result';

const N = CONFIG.months;

/** 決まった値動きのテスト用マーケット */
function fixedMarket(fn: (m: number) => number): Market {
  return { seed: 0, prices: Array.from({ length: N + 1 }, (_, m) => fn(m)), scenarios: [] };
}

const alloc = { investPerMonth: 40_000, savePerMonth: 10_000 };

describe('一度も売らない場合', () => {
  it('評価額 = Σ(積立額 / 各月の価格) × 最終価格', () => {
    const market = generateMarket(123);
    const r = runSimulation(market, alloc, [], []);
    let units = 0;
    for (let m = 0; m < N; m++) units += alloc.investPerMonth / market.prices[m];
    expect(r.finalValue).toBeCloseTo(units * market.prices[N], 4);
    expect(r.contributed).toBe(alloc.investPerMonth * N);
    expect(r.profit).toBeCloseTo(r.finalValue - r.contributed, 4);
    expect(r.emergencyFinal).toBe(CONFIG.money.initialEmergencyFund + alloc.savePerMonth * N);
  });

  it('価格が一定なら評価額 = 元本、損益 0、非課税額 0', () => {
    const r = runSimulation(fixedMarket(() => 10_000), alloc, [], []);
    expect(r.finalValue).toBeCloseTo(alloc.investPerMonth * N, 6);
    expect(r.profit).toBeCloseTo(0, 6);
    expect(r.taxSaved).toBeCloseTo(0, 6);
  });

  it('非課税額 = 利益 × 20.315%', () => {
    // 最後の月だけ2倍になる
    const r = runSimulation(fixedMarket((m) => (m === N ? 20_000 : 10_000)), alloc, [], []);
    expect(r.profit).toBeCloseTo(alloc.investPerMonth * N, 4);
    expect(r.taxSaved).toBeCloseTo(alloc.investPerMonth * N * 0.20315, 4);
  });
});

describe('売却と買い戻し', () => {
  it('売却中の積立は現金に貯まり、買い戻しで現金全額を投じる', () => {
    const market = fixedMarket((m) => (m < 10 ? 10_000 : 5_000));
    const pf = new Portfolio(market, alloc, []);
    for (let m = 0; m < 5; m++) pf.startMonth(m);
    pf.sell(4, 'sell'); // 5か月分 = 20万円で売却
    expect(pf.cash).toBeCloseTo(200_000, 6);
    expect(pf.units).toBe(0);
    for (let m = 5; m < 12; m++) pf.startMonth(m);
    expect(pf.cash).toBeCloseTo(200_000 + 7 * 40_000, 6);
    pf.buy(11);
    expect(pf.cash).toBe(0);
    expect(pf.units).toBeCloseTo(480_000 / 5_000, 6);
    expect(pf.sellCount).toBe(1);
    expect(pf.buyCount).toBe(1);
  });

  it('同じ操作ログを再生すると同じ結果になる', () => {
    const market = generateMarket(5);
    const actions = [
      { month: 30, type: 'sell' as const },
      { month: 50, type: 'buy' as const },
      { month: 100, type: 'letGo' as const },
    ];
    const a = runSimulation(market, alloc, [], actions);
    const b = runSimulation(market, alloc, [], actions);
    expect(a).toEqual(b);
    expect(a.sellCount).toBe(1);
    expect(a.letGoCount).toBe(1);
    expect(a.endedInvested).toBe(false);
  });
});

describe('ライフイベント', () => {
  it('防衛資金で足りるときは強制売却しない', () => {
    const market = fixedMarket(() => 10_000);
    const ev: LifeEvent[] = [{ month: 0, id: 'x', name: 'テスト', cost: 100_000 }];
    const pf = new Portfolio(market, alloc, ev);
    const out = pf.startMonth(0)!;
    expect(out.fromEmergency).toBe(100_000);
    expect(out.forcedSale).toBe(0);
    expect(pf.emergency).toBe(300_000 + 10_000 - 100_000);
  });

  it('防衛資金が足りないとき、不足分だけが強制売却される', () => {
    const market = fixedMarket(() => 10_000);
    // 積立5万・貯金0：10か月で評価額50万、防衛資金30万のまま
    const ev: LifeEvent[] = [{ month: 9, id: 'move', name: '引っ越し', cost: 400_000 }];
    const pf = new Portfolio(market, { investPerMonth: 50_000, savePerMonth: 0 }, ev);
    for (let m = 0; m < 9; m++) pf.startMonth(m);
    const out = pf.startMonth(9)!;
    expect(out.fromEmergency).toBe(300_000);
    expect(out.forcedSale).toBeCloseTo(100_000, 6);
    expect(pf.emergency).toBe(0);
    expect(pf.units * 10_000).toBeCloseTo(500_000 - 100_000, 6);
    expect(out.debt).toBe(0);
    expect(pf.withdrawn).toBeCloseTo(100_000, 6);
  });

  it('売却中は現金から払い、それでも足りなければ借金になる', () => {
    const market = fixedMarket(() => 10_000);
    const ev: LifeEvent[] = [{ month: 2, id: 'job', name: '無収入', cost: 600_000 }];
    const pf = new Portfolio(market, { investPerMonth: 50_000, savePerMonth: 0 }, ev);
    pf.startMonth(0);
    pf.sell(0, 'sell');
    pf.startMonth(1);
    const out = pf.startMonth(2)!;
    expect(out.fromEmergency).toBe(300_000);
    expect(out.fromCash).toBeCloseTo(150_000, 6);
    expect(out.forcedSale).toBe(0);
    expect(out.debt).toBeCloseTo(150_000, 6);
    expect(pf.emergency).toBeCloseTo(-150_000, 6);
  });

  it('強制売却は、その月の価格で売る', () => {
    const market = fixedMarket((m) => (m < 5 ? 10_000 : 6_000));
    const ev: LifeEvent[] = [{ month: 5, id: 'h', name: '入院', cost: 400_000 }];
    const pf = new Portfolio(market, { investPerMonth: 50_000, savePerMonth: 0 }, ev);
    for (let m = 0; m < 5; m++) pf.startMonth(m);
    const unitsBefore = pf.units + 50_000 / 6_000;
    const out = pf.startMonth(5)!;
    expect(out.price).toBe(6_000);
    expect(out.forcedSale).toBeCloseTo(100_000, 6);
    expect(pf.units).toBeCloseTo(unitsBefore - 100_000 / 6_000, 6);
    expect(out.drawdown).toBeCloseTo(0.4, 6);
  });
});

describe('ずっと持ち続けていたら', () => {
  it('実プレイと同じ値動き・同じイベントを使い、操作だけを除いて計算する', () => {
    const market = generateMarket(999);
    const events: LifeEvent[] = [{ month: 60, id: 'move', name: '引っ越し', cost: 400_000 }];
    const actions = [
      { month: 40, type: 'sell' as const },
      { month: 80, type: 'buy' as const },
    ];
    const res = evaluateGame(market, alloc, events, actions);
    const expectedHold = runSimulation(market, alloc, events, []);
    expect(res.hold).toEqual(expectedHold);
    expect(res.hold.sellCount).toBe(0);
    expect(res.actual).toEqual(runSimulation(market, alloc, events, actions));
    expect(res.diffFromHold).toBeCloseTo(res.actual.finalValue - res.hold.finalValue, 6);
    // 同じ市場の価格で評価されている
    expect(res.hold.eventOutcomes[0].price).toBe(market.prices[60]);
    expect(res.actual.eventOutcomes[0].price).toBe(market.prices[60]);
  });

  it('何も操作しなければ実プレイと完全に一致する', () => {
    const market = generateMarket(31);
    const res = evaluateGame(market, alloc, [], []);
    expect(res.diffFromHold).toBe(0);
    expect(res.actual).toEqual(res.hold);
  });
});

describe('バランス', () => {
  it('持ち続けた人は、高い確率で元本を上回る', () => {
    let win = 0;
    const n = 300;
    for (let seed = 1; seed <= n; seed++) {
      const r = runSimulation(generateMarket(seed), alloc, [], []);
      if (r.profit > 0) win++;
    }
    expect(win / n).toBeGreaterThan(0.85);
  });
});
