// ライフイベントのスケジュール。シードと値動きから決まる（同じシードなら同じ人生）。

import { CONFIG, type Config } from '../config';
import { isCrashMonth, type Market } from './market';
import { createRng, deriveSeed } from './rng';

export interface LifeEvent {
  month: number;
  id: string;
  name: string;
  cost: number;
}

export function scheduleLifeEvents(market: Market, cfg: Config = CONFIG): LifeEvent[] {
  const ec = cfg.lifeEvents;
  const rng = createRng(deriveSeed(market.seed, 2));
  const months: number[] = [];

  const farEnough = (m: number) => months.every((x) => Math.abs(x - m) >= ec.minGapMonths);

  // 山場（ずるずる型）の下落〜底のあたりに、意図的に1回ねじ込む
  const major = market.scenarios.find((s) => s.id === cfg.market.mandatoryScenario);
  if (major && rng.next() < ec.forceInMajorCrashProb) {
    const from = Math.max(ec.earliestMonth, major.startMonth + 3);
    const to = Math.min(cfg.months - 1, major.bottomMonth + 3);
    if (to >= from) months.push(rng.int(from, to));
  }

  for (let m = ec.earliestMonth; m < cfg.months; m++) {
    const p = ec.baseMonthlyProb * (isCrashMonth(market.scenarios, m) ? ec.crashProbMultiplier : 1);
    // 乱数は毎月必ず1回引く（スケジュールの再現性を保つ）
    const roll = rng.next();
    if (roll < p && farEnough(m)) months.push(m);
  }

  months.sort((a, b) => a - b);
  return months.map((month) => {
    const def = rng.weighted(ec.list);
    return { month, id: def.id, name: def.name, cost: def.cost };
  });
}
