// 積立・売却・買い直し・強制売却（ファンドごと）。
// 同じ入力（値動き・設定・イベント・操作ログ）からは必ず同じ結果になる。
//
// 売る ＝ そのファンドを全部売って貯金に移す（以降、そのファンドの積立分も貯金に回る）。
// 買い直す ＝ そのファンドから移した貯金の分で、そのファンドを買い直して積立を再開する。

import { CONFIG, type Config, type FundId } from '../config';
import type { LifeEvent } from './events';
import { fundPrices, type Market } from './market';

export interface Allocation {
  /** ファンドごとの毎月の NISA 積立額（円） */
  invest: Partial<Record<FundId, number>>;
  /** 毎月の生活防衛資金への貯金額（円） */
  savePerMonth: number;
}

/** 積立額が 0 より大きいファンド（config の並び順） */
export function allocatedFunds(a: Allocation, cfg: Config = CONFIG): FundId[] {
  return cfg.funds.map((f) => f.id).filter((id) => (a.invest[id] ?? 0) > 0);
}

export function totalInvest(a: Allocation): number {
  return Object.values(a.invest).reduce((s, v) => s + (v ?? 0), 0);
}

export type ActionType = 'sell' | 'letGo' | 'buy';

/**
 * プレイヤーの操作ログ1件。month の月初処理の後に実行される。
 * fund を省略すると、売るときは積立中の全ファンド、買い直すときは停止中の全ファンドが対象。
 * letGo（握力切れ）は常に全ファンド。
 */
export interface PlayerAction {
  month: number;
  type: ActionType;
  fund?: FundId;
}

export interface TradeRecord {
  month: number;
  type: ActionType;
  fund: FundId;
  price: number;
  amount: number;
}

export interface LifeEventOutcome {
  event: LifeEvent;
  /** 市場全体の指数 */
  price: number;
  /** 市場全体の直近高値からの下落率 */
  drawdown: number;
  fromEmergency: number;
  /** NISAから移した貯金から払った額 */
  fromCash: number;
  /** ファンドを強制的に売った額（合計） */
  forcedSale: number;
  /** ファンドごとの強制売却額 */
  forcedByFund: Partial<Record<FundId, number>>;
  /** それでも足りず、借金（防衛資金のマイナス）になった額 */
  debt: number;
}

export interface Holding {
  units: number;
  /** このファンドを売って貯金に移した分（＋停止中の積立分） */
  cash: number;
  /** 積立中か（false = 売って停止中） */
  active: boolean;
  contributed: number;
  withdrawn: number;
  /** 信託報酬の目安（累計） */
  fee: number;
}

export class Portfolio {
  readonly holdings: Partial<Record<FundId, Holding>> = {};
  readonly funds: FundId[];
  emergency: number;
  /** 積立元本（積み立てた額の合計。停止中に貯金へ回った分も含む） */
  contributed = 0;
  /** ライフイベントのために投資から引き出した額（移した貯金からの支払い＋強制売却） */
  withdrawn = 0;

  sellCount = 0;
  letGoCount = 0;
  buyCount = 0;
  trades: TradeRecord[] = [];
  eventOutcomes: LifeEventOutcome[] = [];

  private peak: number;
  private lastProcessedMonth = -1;
  private readonly eventsByMonth = new Map<number, LifeEvent>();
  private readonly feeRate: Partial<Record<FundId, number>> = {};

  constructor(
    readonly market: Market,
    readonly allocation: Allocation,
    events: readonly LifeEvent[],
    readonly cfg: Config = CONFIG,
  ) {
    this.emergency = cfg.money.initialEmergencyFund;
    this.peak = market.prices[0];
    this.funds = allocatedFunds(allocation, cfg);
    for (const f of this.funds) {
      this.holdings[f] = { units: 0, cash: 0, active: true, contributed: 0, withdrawn: 0, fee: 0 };
      this.feeRate[f] = cfg.funds.find((x) => x.id === f)?.fee ?? 0;
    }
    for (const e of events) this.eventsByMonth.set(e.month, e);
  }

  holding(f: FundId): Holding {
    const h = this.holdings[f];
    if (!h) throw new Error(`ファンド ${f} は積立していません`);
    return h;
  }

  price(f: FundId, month: number): number {
    return fundPrices(this.market, f)[month];
  }

  /** どれか1つでも積立中なら true */
  get invested(): boolean {
    return this.funds.some((f) => this.holding(f).active);
  }

  /** NISA の評価額（ファンドの時価のみ） */
  nisaValue(month: number): number {
    return this.funds.reduce((s, f) => s + this.holding(f).units * this.price(f, month), 0);
  }

  /** NISA から移した貯金の合計 */
  get cash(): number {
    return this.funds.reduce((s, f) => s + this.holding(f).cash, 0);
  }

  /** 投資用のお金の合計（NISA の時価＋移した貯金） */
  value(month: number): number {
    return this.nisaValue(month) + this.cash;
  }

  fundValue(f: FundId, month: number): number {
    const h = this.holding(f);
    return h.units * this.price(f, month) + h.cash;
  }

  /** 月初の処理：積立とライフイベント。同じ月を二度処理しない */
  startMonth(month: number): LifeEventOutcome | null {
    if (month <= this.lastProcessedMonth) throw new Error(`month ${month} は処理済みです`);
    if (month >= this.cfg.months) throw new Error(`month ${month} は期間外です`);
    this.lastProcessedMonth = month;
    const idx = this.market.prices[month];
    if (idx > this.peak) this.peak = idx;

    for (const f of this.funds) {
      const h = this.holding(f);
      const p = this.price(f, month);
      h.fee += (h.units * p * (this.feeRate[f] ?? 0)) / 12;
      const inv = this.allocation.invest[f] ?? 0;
      if (h.active) h.units += inv / p;
      else h.cash += inv;
      h.contributed += inv;
      this.contributed += inv;
    }
    this.emergency += this.allocation.savePerMonth;

    const ev = this.eventsByMonth.get(month);
    if (!ev) return null;
    const outcome = this.payLifeEvent(ev, month);
    this.eventOutcomes.push(outcome);
    return outcome;
  }

  private payLifeEvent(event: LifeEvent, month: number): LifeEventOutcome {
    let remaining = event.cost;
    const fromEmergency = Math.min(remaining, Math.max(0, this.emergency));
    this.emergency -= fromEmergency;
    remaining -= fromEmergency;

    // 移した貯金から（ファンドごとの残高に比例して）
    const cashTotal = this.cash;
    const fromCash = Math.min(remaining, cashTotal);
    if (fromCash > 0) {
      for (const f of this.funds) {
        const h = this.holding(f);
        const take = (fromCash * h.cash) / cashTotal;
        h.cash = Math.max(0, h.cash - take);
        h.withdrawn += take;
      }
    }
    remaining -= fromCash;

    // それでも足りなければファンドを強制売却（時価に比例して）
    const fundValue = this.nisaValue(month);
    const forcedSale = Math.min(remaining, fundValue);
    const forcedByFund: Partial<Record<FundId, number>> = {};
    if (forcedSale > 0) {
      const all = forcedSale >= fundValue - 1e-6;
      for (const f of this.funds) {
        const h = this.holding(f);
        const p = this.price(f, month);
        const v = h.units * p;
        if (v <= 0) continue;
        const sell = all ? v : (forcedSale * v) / fundValue;
        h.units = all ? 0 : h.units - sell / p;
        h.withdrawn += sell;
        forcedByFund[f] = sell;
      }
      remaining -= forcedSale;
    }

    const debt = remaining;
    this.emergency -= debt;
    this.withdrawn += fromCash + forcedSale;

    return {
      event,
      price: this.market.prices[month],
      drawdown: 1 - this.market.prices[month] / this.peak,
      fromEmergency,
      fromCash,
      forcedSale,
      forcedByFund,
      debt,
    };
  }

  /** 売る：fund を省略すると積立中の全ファンド。売った分は貯金へ */
  sell(month: number, type: 'sell' | 'letGo', fund?: FundId): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holdings[f]?.active);
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const h = this.holding(f);
      const p = this.price(f, month);
      const amount = h.units * p;
      h.cash += amount;
      h.units = 0;
      h.active = false;
      if (type === 'sell') this.sellCount++;
      recs.push({ month, type, fund: f, price: p, amount });
    }
    if (type === 'letGo' && recs.length > 0) this.letGoCount++;
    this.trades.push(...recs);
    return recs;
  }

  /** 買い直す：fund を省略すると停止中の全ファンド。そのファンドから移した貯金の分で買う */
  buy(month: number, fund?: FundId): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holdings[f] && !this.holding(f).active);
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const h = this.holding(f);
      const p = this.price(f, month);
      const amount = h.cash;
      h.units += amount / p;
      h.cash = 0;
      h.active = true;
      this.buyCount++;
      recs.push({ month, type: 'buy', fund: f, price: p, amount });
    }
    this.trades.push(...recs);
    return recs;
  }

  apply(action: PlayerAction): TradeRecord[] {
    if (action.type === 'buy') return this.buy(action.month, action.fund);
    if (action.type === 'letGo') return this.sell(action.month, 'letGo');
    return this.sell(action.month, 'sell', action.fund);
  }
}

export interface FundSummary {
  fund: FundId;
  finalValue: number;
  contributed: number;
  withdrawn: number;
  profit: number;
  fee: number;
  endedActive: boolean;
}

export interface SimSummary {
  /** 最終評価額（NISA の時価＋NISA から移した貯金） */
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
  /** 信託報酬の目安（合計） */
  feeTotal: number;
  /** 自分で売った回数（ファンドごとに数える） */
  sellCount: number;
  letGoCount: number;
  buyCount: number;
  /** 最後に、どのファンドも積立中だった */
  endedInvested: boolean;
  emergencyFinal: number;
  byFund: FundSummary[];
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
  const last = cfg.months;
  const finalValue = pf.value(last);
  const profit = finalValue + pf.withdrawn - pf.contributed;
  const byFund = pf.funds.map((f): FundSummary => {
    const h = pf.holding(f);
    const v = pf.fundValue(f, last);
    return {
      fund: f,
      finalValue: v,
      contributed: h.contributed,
      withdrawn: h.withdrawn,
      profit: v + h.withdrawn - h.contributed,
      fee: h.fee,
      endedActive: h.active,
    };
  });
  return {
    finalValue,
    contributed: pf.contributed,
    withdrawn: pf.withdrawn,
    profit,
    profitRate: pf.contributed > 0 ? profit / pf.contributed : 0,
    taxSaved: Math.max(0, profit) * cfg.tax.rate,
    forcedSaleTotal: pf.eventOutcomes.reduce((s, o) => s + o.forcedSale, 0),
    feeTotal: byFund.reduce((s, b) => s + b.fee, 0),
    sellCount: pf.sellCount,
    letGoCount: pf.letGoCount,
    buyCount: pf.buyCount,
    endedInvested: byFund.every((b) => b.endedActive),
    emergencyFinal: pf.emergency,
    byFund,
    trades: pf.trades.slice(),
    eventOutcomes: pf.eventOutcomes.slice(),
  };
}
