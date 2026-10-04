// 積立・売却・買い直し・強制売却（ファンドごと）。
// 同じ入力（値動き・設定・イベント・操作ログ）からは必ず同じ結果になる。
//
// 現実の口座に近い形にしている：
// 売る ＝ そのファンドを全部売って、代金は銀行口座（＝生活防衛資金）に入る。
//         以降、そのファンドの毎月の積立分も積立されずに口座（生活防衛資金）に残る。
// 再開 ＝ そのファンドの積立を再開する。そのとき生活防衛資金から好きな額を移して買い直せる（0円でもよい）。

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
 * fund を省略すると、売るときは積立中の全ファンド、再開するときは停止中の全ファンドが対象。
 * letGo（握力切れ）は常に全ファンド。
 * amount は再開（buy）のときに生活防衛資金から移して買い直す額（fund を指定したときだけ有効）。
 */
export interface PlayerAction {
  month: number;
  type: ActionType;
  fund?: FundId;
  amount?: number;
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
  /** ファンドを強制的に売った額（合計） */
  forcedSale: number;
  /** ファンドごとの強制売却額 */
  forcedByFund: Partial<Record<FundId, number>>;
  /** それでも足りず、借金（防衛資金のマイナス）になった額 */
  debt: number;
}

export interface Holding {
  units: number;
  /** 積立中か（false = 売って停止中） */
  active: boolean;
  /** このファンドに入れたお金（積立＋再開時の買い直し） */
  contributed: number;
  /** このファンドから出したお金（売却＋強制売却） */
  withdrawn: number;
  /** 信託報酬の目安（累計） */
  fee: number;
}

export class Portfolio {
  readonly holdings: Partial<Record<FundId, Holding>> = {};
  readonly funds: FundId[];
  emergency: number;
  /** 積立元本＝NISA に入れたお金の合計（毎月の積立＋再開時の買い直し） */
  contributed = 0;
  /** NISA から出したお金の合計（売却＋握力切れ＋強制売却）。出したお金は生活防衛資金に入る */
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
      this.holdings[f] = { units: 0, active: true, contributed: 0, withdrawn: 0, fee: 0 };
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

  /** 資産の合計（NISA の時価＋生活防衛資金） */
  totalAssets(month: number): number {
    return this.nisaValue(month) + this.emergency;
  }

  fundValue(f: FundId, month: number): number {
    return this.holding(f).units * this.price(f, month);
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
      if (h.active) {
        h.units += inv / p;
        h.contributed += inv;
        this.contributed += inv;
      } else {
        // 積立を止めているファンドの分は、積み立てずに口座（生活防衛資金）に残る
        this.emergency += inv;
      }
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
    this.withdrawn += forcedSale;

    return {
      event,
      price: this.market.prices[month],
      drawdown: 1 - this.market.prices[month] / this.peak,
      fromEmergency,
      forcedSale,
      forcedByFund,
      debt,
    };
  }

  /** 売る：fund を省略すると積立中の全ファンド。代金は生活防衛資金へ */
  sell(month: number, type: 'sell' | 'letGo', fund?: FundId): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holdings[f]?.active);
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const h = this.holding(f);
      const p = this.price(f, month);
      const amount = h.units * p;
      this.emergency += amount;
      h.withdrawn += amount;
      this.withdrawn += amount;
      h.units = 0;
      h.active = false;
      if (type === 'sell') this.sellCount++;
      recs.push({ month, type, fund: f, price: p, amount });
    }
    if (type === 'letGo' && recs.length > 0) this.letGoCount++;
    this.trades.push(...recs);
    return recs;
  }

  /**
   * 再開：積立を再開し、生活防衛資金から amount 円を移して買い直す（生活防衛資金の残高まで）。
   * fund を省略すると停止中の全ファンドの積立を再開する（買い直しはしない）
   */
  buy(month: number, fund?: FundId, amount = 0): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holdings[f] && !this.holding(f).active);
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const h = this.holding(f);
      const p = this.price(f, month);
      const amt = fund ? Math.max(0, Math.min(amount, this.emergency)) : 0;
      h.units += amt / p;
      h.contributed += amt;
      this.contributed += amt;
      this.emergency -= amt;
      h.active = true;
      this.buyCount++;
      recs.push({ month, type: 'buy', fund: f, price: p, amount: amt });
    }
    this.trades.push(...recs);
    return recs;
  }

  apply(action: PlayerAction): TradeRecord[] {
    if (action.type === 'buy') return this.buy(action.month, action.fund, action.amount ?? 0);
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
  /** 最終評価額（NISA の時価） */
  finalValue: number;
  /** 最終的な資産（NISA の時価＋生活防衛資金）。「ずっと持ち続けていたら」との比較やハイスコアに使う */
  totalAssets: number;
  /** 積立元本（NISA に入れたお金） */
  contributed: number;
  /** NISA から出したお金（売却・強制売却） */
  withdrawn: number;
  /** 損益 = 最終評価額 + NISA から出したお金 − NISA に入れたお金 */
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
  const finalValue = pf.nisaValue(last);
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
    totalAssets: finalValue + pf.emergency,
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
