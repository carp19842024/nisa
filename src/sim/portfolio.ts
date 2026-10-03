// 積立・売却・買い戻し・強制売却。
// 同じ入力（値動き・設定・イベント・操作ログ）からは必ず同じ結果になる。

import { CONFIG, type Config } from '../config';
import type { LifeEvent } from './events';
import type { Market } from './market';

export interface Allocation {
  /** 毎月の NISA 積立額（円） */
  investPerMonth: number;
  /** 毎月の生活防衛資金への貯金額（円） */
  savePerMonth: number;
}

export type ActionType = 'sell' | 'letGo' | 'buy';

/** プレイヤーの操作ログ1件。month の月初処理の後に実行される */
export interface PlayerAction {
  month: number;
  type: ActionType;
}

export interface TradeRecord {
  month: number;
  type: ActionType;
  price: number;
  amount: number;
}

export interface LifeEventOutcome {
  event: LifeEvent;
  price: number;
  /** 直近高値からの下落率 */
  drawdown: number;
  fromEmergency: number;
  /** 売却中の現金から払った額 */
  fromCash: number;
  /** ファンドを強制的に売った額 */
  forcedSale: number;
  /** それでも足りず、借金（防衛資金のマイナス）になった額 */
  debt: number;
}

export interface PortfolioSnapshot {
  units: number;
  cash: number;
  invested: boolean;
  emergency: number;
  contributed: number;
  withdrawn: number;
}

export class Portfolio {
  units = 0;
  /** 売却中にファンドの外に置いている現金（NISA 用のお金） */
  cash = 0;
  invested = true;
  emergency: number;
  /** 積立元本（積み立てた額の合計） */
  contributed = 0;
  /** ライフイベントのために投資から引き出した額（現金からの支払い＋強制売却） */
  withdrawn = 0;

  sellCount = 0;
  letGoCount = 0;
  buyCount = 0;
  trades: TradeRecord[] = [];
  eventOutcomes: LifeEventOutcome[] = [];

  private peak: number;
  private lastProcessedMonth = -1;
  private readonly eventsByMonth = new Map<number, LifeEvent>();

  constructor(
    readonly market: Market,
    readonly allocation: Allocation,
    events: readonly LifeEvent[],
    readonly cfg: Config = CONFIG,
  ) {
    this.emergency = cfg.money.initialEmergencyFund;
    this.peak = market.prices[0];
    for (const e of events) this.eventsByMonth.set(e.month, e);
  }

  price(month: number): number {
    return this.market.prices[month];
  }

  value(price: number): number {
    return this.units * price + this.cash;
  }

  /** 月初の処理：積立とライフイベント。同じ月を二度処理しない */
  startMonth(month: number): LifeEventOutcome | null {
    if (month <= this.lastProcessedMonth) throw new Error(`month ${month} は処理済みです`);
    if (month >= this.cfg.months) throw new Error(`month ${month} は期間外です`);
    this.lastProcessedMonth = month;
    const p = this.price(month);
    if (p > this.peak) this.peak = p;

    const { investPerMonth, savePerMonth } = this.allocation;
    if (this.invested) this.units += investPerMonth / p;
    else this.cash += investPerMonth;
    this.contributed += investPerMonth;
    this.emergency += savePerMonth;

    const ev = this.eventsByMonth.get(month);
    if (!ev) return null;
    const outcome = this.payLifeEvent(ev, p);
    this.eventOutcomes.push(outcome);
    return outcome;
  }

  private payLifeEvent(event: LifeEvent, price: number): LifeEventOutcome {
    let remaining = event.cost;
    const fromEmergency = Math.min(remaining, Math.max(0, this.emergency));
    this.emergency -= fromEmergency;
    remaining -= fromEmergency;

    const fromCash = Math.min(remaining, this.cash);
    this.cash -= fromCash;
    remaining -= fromCash;

    const fundValue = this.units * price;
    const forcedSale = Math.min(remaining, fundValue);
    if (forcedSale > 0) {
      this.units = fundValue - forcedSale <= 1e-6 ? 0 : this.units - forcedSale / price;
      remaining -= forcedSale;
    }

    const debt = remaining;
    this.emergency -= debt;
    this.withdrawn += fromCash + forcedSale;

    return {
      event,
      price,
      drawdown: 1 - price / this.peak,
      fromEmergency,
      fromCash,
      forcedSale,
      debt,
    };
  }

  /** 全額売却。type は自分で売った（sell）か握力が尽きた（letGo）か */
  sell(month: number, type: 'sell' | 'letGo'): TradeRecord | null {
    if (!this.invested) return null;
    const p = this.price(month);
    const amount = this.units * p;
    this.cash += amount;
    this.units = 0;
    this.invested = false;
    if (type === 'sell') this.sellCount++;
    else this.letGoCount++;
    const rec: TradeRecord = { month, type, price: p, amount };
    this.trades.push(rec);
    return rec;
  }

  /** 現金全額で買い戻す */
  buy(month: number): TradeRecord | null {
    if (this.invested) return null;
    const p = this.price(month);
    const amount = this.cash;
    this.units += amount / p;
    this.cash = 0;
    this.invested = true;
    this.buyCount++;
    const rec: TradeRecord = { month, type: 'buy', price: p, amount };
    this.trades.push(rec);
    return rec;
  }

  apply(action: PlayerAction): TradeRecord | null {
    if (action.type === 'buy') return this.buy(action.month);
    return this.sell(action.month, action.type);
  }

  snapshot(): PortfolioSnapshot {
    return {
      units: this.units,
      cash: this.cash,
      invested: this.invested,
      emergency: this.emergency,
      contributed: this.contributed,
      withdrawn: this.withdrawn,
    };
  }
}

export interface SimSummary {
  /** 最終評価額（ファンド＋売却中の現金） */
  finalValue: number;
  /** 積立元本 */
  contributed: number;
  /** ライフイベントのために投資から引き出した額 */
  withdrawn: number;
  /** 損益 = 最終評価額 + 引き出し額 − 積立元本 */
  profit: number;
  /** 損益率（積立元本比） */
  profitRate: number;
  /** 課税口座だった場合の税金の目安（＝NISAで非課税になった額） */
  taxSaved: number;
  /** 強制売却の合計 */
  forcedSaleTotal: number;
  sellCount: number;
  letGoCount: number;
  buyCount: number;
  endedInvested: boolean;
  emergencyFinal: number;
  trades: TradeRecord[];
  eventOutcomes: LifeEventOutcome[];
}

/** 操作ログを最初から最後まで再生して結果を出す */
export function runSimulation(
  market: Market,
  allocation: Allocation,
  events: readonly LifeEvent[],
  actions: readonly PlayerAction[],
  cfg: Config = CONFIG,
): SimSummary {
  const pf = new Portfolio(market, allocation, events, cfg);
  const sorted = actions.map((a, i) => ({ a, i })).sort((x, y) => x.a.month - y.a.month || x.i - y.i);
  let k = 0;
  for (let m = 0; m < cfg.months; m++) {
    pf.startMonth(m);
    while (k < sorted.length && sorted[k].a.month === m) {
      pf.apply(sorted[k].a);
      k++;
    }
  }
  return summarize(pf, cfg);
}

export function summarize(pf: Portfolio, cfg: Config = CONFIG): SimSummary {
  const finalPrice = pf.market.prices[cfg.months];
  const finalValue = pf.value(finalPrice);
  const profit = finalValue + pf.withdrawn - pf.contributed;
  return {
    finalValue,
    contributed: pf.contributed,
    withdrawn: pf.withdrawn,
    profit,
    profitRate: pf.contributed > 0 ? profit / pf.contributed : 0,
    taxSaved: Math.max(0, profit) * cfg.tax.rate,
    forcedSaleTotal: pf.eventOutcomes.reduce((s, o) => s + o.forcedSale, 0),
    sellCount: pf.sellCount,
    letGoCount: pf.letGoCount,
    buyCount: pf.buyCount,
    endedInvested: pf.invested,
    emergencyFinal: pf.emergency,
    trades: pf.trades.slice(),
    eventOutcomes: pf.eventOutcomes.slice(),
  };
}
