// 結果画面に出す数値をまとめて計算する。

import { CONFIG, type Config } from '../config';
import type { LifeEvent } from './events';
import type { Market } from './market';
import { runSimulation, totalInvest, type Allocation, type PlayerAction, type SimSummary } from './portfolio';
import { determineTitle, type Title } from './titles';

export interface GameResult {
  seed: number;
  allocation: Allocation;
  actual: SimSummary;
  /** 「ずっと持ち続けていたら」：同じ値動き・同じ配分・同じライフイベントで、自分では一度も売らなかった場合 */
  hold: SimSummary;
  /** 同じ積立額をすべて「ぜんぶ入りファンド」にして、一度も売らなかった場合 */
  zenbuOnly: SimSummary;
  /** 実際 − ずっと持ち続けていたら */
  diffFromHold: number;
  title: Title;
}

export function evaluateGame(
  market: Market,
  allocation: Allocation,
  events: readonly LifeEvent[],
  actions: readonly PlayerAction[],
  cfg: Config = CONFIG,
): GameResult {
  const actual = runSimulation(market, allocation, events, actions, cfg);
  const hold = runSimulation(market, allocation, events, [], cfg);
  const zenbuOnly = runSimulation(
    market,
    { invest: { zenbu: totalInvest(allocation) }, savePerMonth: allocation.savePerMonth },
    events,
    [],
    cfg,
  );
  return {
    seed: market.seed,
    allocation,
    actual,
    hold,
    zenbuOnly,
    diffFromHold: actual.finalValue - hold.finalValue,
    title: determineTitle(actual, market, { allocation, zenbuOnlyFinal: zenbuOnly.finalValue }, cfg),
  };
}
