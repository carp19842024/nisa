import { CONFIG, type FundId } from '../../src/config';
import type { Market } from '../../src/sim/market';
import type { Allocation } from '../../src/sim/portfolio';

export const N = CONFIG.months;

/** 決まった値動きのテスト用マーケット。zenbu は市場全体と同じ値動き */
export function fixedMarket(fn: (m: number) => number, others: Partial<Record<FundId, (m: number) => number>> = {}): Market {
  const series = (f: (m: number) => number) => Array.from({ length: N + 1 }, (_, m) => f(m));
  const prices = series(fn);
  const funds: Market['funds'] = { zenbu: prices };
  for (const [id, f] of Object.entries(others)) funds[id as FundId] = series(f!);
  return { seed: 0, prices, funds, scenarios: [], fundBusts: [] };
}

export function zenbu(invest: number, save: number): Allocation {
  return { invest: { zenbu: invest }, savePerMonth: save };
}
