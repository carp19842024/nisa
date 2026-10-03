import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import type { LifeEvent } from '../../src/sim/events';
import { fundPrices, generateMarket } from '../../src/sim/market';
import { Portfolio, runSimulation, type Allocation } from '../../src/sim/portfolio';
import { evaluateGame } from '../../src/sim/result';
import { fixedMarket, N, zenbu } from './helpers';

const alloc = zenbu(40_000, 10_000);

describe('一度も売らない場合', () => {
  it('評価額 = Σ(積立額 / 各月の価格) × 最終価格（ファンドごとの合計）', () => {
    const market = generateMarket(123);
    const a: Allocation = { invest: { zenbu: 20_000, rocket: 10_000, gold: 10_000 }, savePerMonth: 10_000 };
    const r = runSimulation(market, a, [], []);
    let expected = 0;
    for (const [f, inv] of Object.entries(a.invest)) {
      const p = fundPrices(market, f as 'zenbu');
      let units = 0;
      for (let m = 0; m < N; m++) units += inv! / p[m];
      expected += units * p[N];
    }
    expect(r.finalValue).toBeCloseTo(expected, 4);
    expect(r.contributed).toBe(40_000 * N);
    expect(r.profit).toBeCloseTo(r.finalValue - r.contributed, 4);
    expect(r.byFund.map((b) => b.fund)).toEqual(['zenbu', 'rocket', 'gold']);
    expect(r.byFund.reduce((s, b) => s + b.finalValue, 0)).toBeCloseTo(r.finalValue, 4);
    expect(r.emergencyFinal).toBe(CONFIG.money.initialEmergencyFund + 10_000 * N);
  });

  it('価格が一定なら評価額 = 元本、損益 0、非課税額 0', () => {
    const r = runSimulation(fixedMarket(() => 10_000), alloc, [], []);
    expect(r.finalValue).toBeCloseTo(40_000 * N, 6);
    expect(r.profit).toBeCloseTo(0, 6);
    expect(r.taxSaved).toBeCloseTo(0, 6);
  });

  it('非課税額 = 利益 × 20.315%', () => {
    const r = runSimulation(fixedMarket((m) => (m === N ? 20_000 : 10_000)), alloc, [], []);
    expect(r.profit).toBeCloseTo(40_000 * N, 4);
    expect(r.taxSaved).toBeCloseTo(40_000 * N * 0.20315, 4);
  });

  it('信託報酬の目安 = Σ(毎月の時価 × 年率 / 12)', () => {
    const r = runSimulation(fixedMarket(() => 10_000), alloc, [], []);
    let fee = 0;
    for (let m = 0; m < N; m++) fee += (40_000 * m * 0.001) / 12;
    expect(r.feeTotal).toBeCloseTo(fee, 4);
  });
});

describe('ファンドを選んで売る・買い直す', () => {
  const market = fixedMarket((m) => (m < 10 ? 10_000 : 5_000), { gold: (m) => (m < 10 ? 10_000 : 12_000) });
  const two: Allocation = { invest: { zenbu: 30_000, gold: 10_000 }, savePerMonth: 10_000 };

  it('売ったファンドだけが貯金に移り、以降そのファンドの積立分も貯金に回る', () => {
    const pf = new Portfolio(market, two, []);
    for (let m = 0; m < 5; m++) pf.startMonth(m);
    const recs = pf.sell(4, 'sell', 'zenbu');
    expect(recs).toHaveLength(1);
    expect(recs[0].amount).toBeCloseTo(150_000, 6);
    expect(pf.holding('zenbu').active).toBe(false);
    expect(pf.holding('gold').active).toBe(true);
    expect(pf.invested).toBe(true);
    for (let m = 5; m < 12; m++) pf.startMonth(m);
    expect(pf.holding('zenbu').cash).toBeCloseTo(150_000 + 7 * 30_000, 6);
    expect(pf.holding('gold').units).toBeCloseTo(12 * 10_000 / 10_000 - 2 * 10_000 / 10_000 + 2 * 10_000 / 12_000, 6);
  });

  it('買い直しは、そのファンドから移した分だけで買う', () => {
    const pf = new Portfolio(market, two, []);
    for (let m = 0; m < 12; m++) {
      pf.startMonth(m);
      if (m === 4) pf.sell(4, 'sell', 'zenbu');
    }
    const cash = pf.holding('zenbu').cash;
    const recs = pf.buy(11, 'zenbu');
    expect(recs[0].amount).toBeCloseTo(cash, 6);
    expect(pf.holding('zenbu').units).toBeCloseTo(cash / 5_000, 6);
    expect(pf.cash).toBe(0);
    expect(pf.sellCount).toBe(1);
    expect(pf.buyCount).toBe(1);
  });

  it('ファンドを省略して売ると、積立中の全ファンドが対象。握力切れも全部売る', () => {
    const pf = new Portfolio(market, two, []);
    pf.startMonth(0);
    expect(pf.sell(0, 'sell')).toHaveLength(2);
    expect(pf.invested).toBe(false);
    expect(pf.buy(0)).toHaveLength(2);
    pf.startMonth(1);
    expect(pf.sell(1, 'letGo')).toHaveLength(2);
    expect(pf.letGoCount).toBe(1);
    expect(pf.sellCount).toBe(2);
  });

  it('同じ操作ログを再生すると同じ結果になる', () => {
    const m = generateMarket(5);
    const actions = [
      { month: 30, type: 'sell' as const, fund: 'rocket' as const },
      { month: 50, type: 'buy' as const, fund: 'rocket' as const },
      { month: 100, type: 'letGo' as const },
    ];
    const a: Allocation = { invest: { zenbu: 20_000, rocket: 20_000 }, savePerMonth: 10_000 };
    const r1 = runSimulation(m, a, [], actions);
    expect(r1).toEqual(runSimulation(m, a, [], actions));
    expect(r1.sellCount).toBe(1);
    expect(r1.letGoCount).toBe(1);
    expect(r1.endedInvested).toBe(false);
  });
});

describe('ライフイベント', () => {
  it('防衛資金で足りるときは強制売却しない', () => {
    const ev: LifeEvent[] = [{ month: 0, id: 'x', name: 'テスト', cost: 100_000 }];
    const pf = new Portfolio(fixedMarket(() => 10_000), alloc, ev);
    const out = pf.startMonth(0)!;
    expect(out.fromEmergency).toBe(100_000);
    expect(out.forcedSale).toBe(0);
    expect(pf.emergency).toBe(300_000 + 10_000 - 100_000);
  });

  it('防衛資金が足りないとき、不足分だけが強制売却される', () => {
    const ev: LifeEvent[] = [{ month: 9, id: 'move', name: '引っ越し', cost: 400_000 }];
    const pf = new Portfolio(fixedMarket(() => 10_000), zenbu(50_000, 0), ev);
    for (let m = 0; m < 9; m++) pf.startMonth(m);
    const out = pf.startMonth(9)!;
    expect(out.fromEmergency).toBe(300_000);
    expect(out.forcedSale).toBeCloseTo(100_000, 6);
    expect(pf.emergency).toBe(0);
    expect(pf.nisaValue(9)).toBeCloseTo(500_000 - 100_000, 6);
    expect(out.debt).toBe(0);
    expect(pf.withdrawn).toBeCloseTo(100_000, 6);
  });

  it('強制売却は、各ファンドの時価に比例して売る', () => {
    const market = fixedMarket(() => 10_000, { gold: () => 10_000 });
    const ev: LifeEvent[] = [{ month: 9, id: 'move', name: '引っ越し', cost: 400_000 }];
    const pf = new Portfolio(market, { invest: { zenbu: 30_000, gold: 20_000 }, savePerMonth: 0 }, ev);
    for (let m = 0; m < 9; m++) pf.startMonth(m);
    const out = pf.startMonth(9)!;
    expect(out.forcedByFund.zenbu).toBeCloseTo(60_000, 6);
    expect(out.forcedByFund.gold).toBeCloseTo(40_000, 6);
  });

  it('売却中は移した貯金から払い、それでも足りなければ借金になる', () => {
    const ev: LifeEvent[] = [{ month: 2, id: 'job', name: '無収入', cost: 600_000 }];
    const pf = new Portfolio(fixedMarket(() => 10_000), zenbu(50_000, 0), ev);
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
    const ev: LifeEvent[] = [{ month: 5, id: 'h', name: '入院', cost: 400_000 }];
    const pf = new Portfolio(fixedMarket((m) => (m < 5 ? 10_000 : 6_000)), zenbu(50_000, 0), ev);
    for (let m = 0; m < 5; m++) pf.startMonth(m);
    const unitsBefore = pf.holding('zenbu').units + 50_000 / 6_000;
    const out = pf.startMonth(5)!;
    expect(out.price).toBe(6_000);
    expect(out.forcedSale).toBeCloseTo(100_000, 6);
    expect(pf.holding('zenbu').units).toBeCloseTo(unitsBefore - 100_000 / 6_000, 6);
    expect(out.drawdown).toBeCloseTo(0.4, 6);
  });
});

describe('ずっと持ち続けていたら', () => {
  const a: Allocation = { invest: { zenbu: 20_000, gold: 20_000 }, savePerMonth: 10_000 };

  it('実プレイと同じ値動き・同じイベントを使い、操作だけを除いて計算する', () => {
    const market = generateMarket(999);
    const events: LifeEvent[] = [{ month: 60, id: 'move', name: '引っ越し', cost: 400_000 }];
    const actions = [
      { month: 40, type: 'sell' as const, fund: 'zenbu' as const },
      { month: 80, type: 'buy' as const, fund: 'zenbu' as const },
    ];
    const res = evaluateGame(market, a, events, actions);
    expect(res.hold).toEqual(runSimulation(market, a, events, []));
    expect(res.hold.sellCount).toBe(0);
    expect(res.actual).toEqual(runSimulation(market, a, events, actions));
    expect(res.diffFromHold).toBeCloseTo(res.actual.finalValue - res.hold.finalValue, 6);
    expect(res.hold.eventOutcomes[0].price).toBe(market.prices[60]);
    expect(res.actual.eventOutcomes[0].price).toBe(market.prices[60]);
  });

  it('「ぜんぶ入りだけ」は同じ積立総額をぜんぶ入りファンドで持ち続けた場合', () => {
    const market = generateMarket(999);
    const res = evaluateGame(market, a, [], []);
    expect(res.zenbuOnly).toEqual(runSimulation(market, zenbu(40_000, 10_000), [], []));
  });

  it('何も操作しなければ実プレイと完全に一致する', () => {
    const res = evaluateGame(generateMarket(31), alloc, [], []);
    expect(res.diffFromHold).toBe(0);
    expect(res.actual).toEqual(res.hold);
  });
});

describe('バランス', () => {
  it('ぜんぶ入りを持ち続けた人は、高い確率で元本を上回る', () => {
    let win = 0;
    const n = 300;
    for (let seed = 1; seed <= n; seed++) if (runSimulation(generateMarket(seed), alloc, [], []).profit > 0) win++;
    expect(win / n).toBeGreaterThan(0.85);
  });
});
