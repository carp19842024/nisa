// 積立・売却・まとめ買い・積立額の変更・強制売却（ファンドごと）。
// 同じ入力（値動き・設定・イベント・操作ログ）からは必ず同じ結果になる。
//
// 現実の口座に近い形にしている：
// - 毎月の余裕資金（積立額の合計＋貯金額）のうち、ファンドの積立額を NISA で買い、残りは生活防衛資金（銀行口座）に入る
// - 売る ＝ そのファンドを全部売って、代金は生活防衛資金に入る。そのファンドの毎月の積立も止まる（積立額 0）
// - 積立額はゲーム中にいつでも変えられる（最初に選ばなかったファンドを始めることもできる）
// - まとめ買い ＝ 生活防衛資金から好きな額を移して買う
// - NISA の購入上限：年間 360万円、生涯 1,800万円（買った額＝簿価で数え、売った分の簿価は翌年に復活する）

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

/**
 * sell  = 売る（fund 省略で全部）。売ったファンドの積立も止まる
 * letGo = 握力切れで全部売る
 * buy   = 生活防衛資金から amount 円でまとめ買い
 * plan  = そのファンドの毎月の積立額を amount 円にする
 * resume = 売って止めたファンドの積立を、売る前の積立額で再開する（fund 省略で全部）
 */
export type ActionType = 'sell' | 'letGo' | 'buy' | 'plan' | 'resume';

/** プレイヤーの操作ログ1件。month の月初処理の後に実行される */
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
  /** 売買額。plan / resume では新しい毎月の積立額 */
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
  /** 毎月の積立額 */
  plan: number;
  /** 売って積立を止める前の積立額（再開のときに使う） */
  lastPlan: number;
  /** 売ったことで積立が止まっている */
  stoppedBySale: boolean;
  /** 簿価（NISA の生涯枠の計算に使う） */
  basis: number;
  /** このファンドに入れたお金（積立＋まとめ買い） */
  contributed: number;
  /** このファンドから出したお金（売却＋強制売却） */
  withdrawn: number;
  /** 信託報酬の目安（累計） */
  fee: number;
}

export interface NisaQuota {
  /** 今年あと買える額 */
  annualLeft: number;
  /** 生涯であと買える額 */
  lifetimeLeft: number;
  /** 実際にあと買える額（小さいほう） */
  left: number;
}

export class Portfolio {
  readonly holdings = {} as Record<FundId, Holding>;
  /** すべてのファンド（config の並び順） */
  readonly funds: FundId[];
  emergency: number;
  /** 積立元本＝NISA に入れたお金の合計（毎月の積立＋まとめ買い） */
  contributed = 0;
  /** NISA から出したお金の合計（売却＋握力切れ＋強制売却）。出したお金は生活防衛資金に入る */
  withdrawn = 0;

  sellCount = 0;
  letGoCount = 0;
  /** 売ったファンドに、また入れた回数（積立の再開・まとめ買い） */
  buyCount = 0;
  trades: TradeRecord[] = [];
  eventOutcomes: LifeEventOutcome[] = [];

  /** 今年 NISA で買った額 */
  yearBought = 0;
  /** 今年売った分の簿価（生涯枠が復活するのは翌年） */
  soldBasisThisYear = 0;
  /** 上限に届いて買えずに生活防衛資金に残った額（合計） */
  overCapTotal = 0;

  /** 毎月の余裕資金（積立額の合計＋貯金額） */
  readonly monthlyIncome: number;
  private peak: number;
  private lastProcessedMonth = -1;
  private readonly eventsByMonth = new Map<number, LifeEvent>();
  private readonly feeRate = {} as Record<FundId, number>;

  constructor(
    readonly market: Market,
    readonly allocation: Allocation,
    events: readonly LifeEvent[],
    readonly cfg: Config = CONFIG,
  ) {
    this.emergency = cfg.money.initialEmergencyFund;
    this.peak = market.prices[0];
    this.monthlyIncome = totalInvest(allocation) + allocation.savePerMonth;
    this.funds = cfg.funds.map((f) => f.id).filter((f) => market.funds[f]);
    for (const f of this.funds) {
      const plan = allocation.invest[f] ?? 0;
      this.holdings[f] = { units: 0, plan, lastPlan: plan, stoppedBySale: false, basis: 0, contributed: 0, withdrawn: 0, fee: 0 };
      this.feeRate[f] = cfg.funds.find((x) => x.id === f)?.fee ?? 0;
    }
    for (const e of events) this.eventsByMonth.set(e.month, e);
  }

  holding(f: FundId): Holding {
    const h = this.holdings[f];
    if (!h) throw new Error(`ファンド ${f} がありません`);
    return h;
  }

  price(f: FundId, month: number): number {
    return fundPrices(this.market, f)[month];
  }

  /** 毎月の積立額の合計 */
  get planTotal(): number {
    return this.funds.reduce((s, f) => s + this.holding(f).plan, 0);
  }

  /** NISA に何か入っている、または積立している */
  get invested(): boolean {
    return this.funds.some((f) => this.holding(f).units > 0 || this.holding(f).plan > 0);
  }

  /** このファンドを持っているか、積立しているか */
  isActive(f: FundId): boolean {
    const h = this.holding(f);
    return h.units > 0 || h.plan > 0;
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

  /** NISA の残り枠 */
  quota(): NisaQuota {
    const nc = this.cfg.nisa;
    const basis = this.funds.reduce((s, f) => s + this.holding(f).basis, 0);
    const annualLeft = Math.max(0, nc.annualCap - this.yearBought);
    const lifetimeLeft = Math.max(0, nc.lifetimeCap - basis - this.soldBasisThisYear);
    return { annualLeft, lifetimeLeft, left: Math.min(annualLeft, lifetimeLeft) };
  }

  /** NISA で買う（枠の範囲まで）。買えた額を返す */
  private purchase(f: FundId, month: number, amount: number): number {
    const amt = Math.max(0, Math.min(amount, this.quota().left));
    if (amt <= 0) return 0;
    const h = this.holding(f);
    h.units += amt / this.price(f, month);
    h.basis += amt;
    h.contributed += amt;
    this.contributed += amt;
    this.yearBought += amt;
    return amt;
  }

  /** 月初の処理：積立とライフイベント。同じ月を二度処理しない */
  startMonth(month: number): LifeEventOutcome | null {
    if (month <= this.lastProcessedMonth) throw new Error(`month ${month} は処理済みです`);
    if (month >= this.cfg.months) throw new Error(`month ${month} は期間外です`);
    this.lastProcessedMonth = month;
    const idx = this.market.prices[month];
    if (idx > this.peak) this.peak = idx;

    // 年が変わったら年間枠を戻し、去年売った分の生涯枠を復活させる
    if (month % 12 === 0) {
      this.yearBought = 0;
      this.soldBasisThisYear = 0;
    }

    for (const f of this.funds) {
      const h = this.holding(f);
      h.fee += (h.units * this.price(f, month) * (this.feeRate[f] ?? 0)) / 12;
    }
    // 毎月の余裕資金：積立額のぶんを NISA で買い、残り（貯金・上限で買えなかった分）は生活防衛資金へ
    let rest = this.monthlyIncome;
    for (const f of this.funds) {
      const plan = this.holding(f).plan;
      if (plan <= 0) continue;
      const bought = this.purchase(f, month, plan);
      this.overCapTotal += plan - bought;
      rest -= bought;
    }
    this.emergency += rest;

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

    // 足りなければファンドを強制売却（時価に比例して）
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
        const frac = all ? 1 : sell / v;
        h.units = all ? 0 : h.units - sell / p;
        this.soldBasisThisYear += h.basis * frac;
        h.basis -= h.basis * frac;
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

  /** 売る：fund を省略すると持っている（積立している）全ファンド。代金は生活防衛資金へ、積立も止まる */
  sell(month: number, type: 'sell' | 'letGo', fund?: FundId): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holdings[f] && this.isActive(f));
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const h = this.holding(f);
      const p = this.price(f, month);
      const amount = h.units * p;
      this.emergency += amount;
      h.withdrawn += amount;
      this.withdrawn += amount;
      this.soldBasisThisYear += h.basis;
      h.basis = 0;
      h.units = 0;
      if (h.plan > 0) h.lastPlan = h.plan;
      h.plan = 0;
      h.stoppedBySale = true;
      if (type === 'sell') this.sellCount++;
      recs.push({ month, type, fund: f, price: p, amount });
    }
    if (type === 'letGo' && recs.length > 0) this.letGoCount++;
    this.trades.push(...recs);
    return recs;
  }

  /** 売って止めたファンドに、また入れたら「再開」として数える */
  private markRestart(f: FundId): void {
    const h = this.holding(f);
    if (h.stoppedBySale) {
      h.stoppedBySale = false;
      this.buyCount++;
    }
  }

  /** あと何円まで、このファンドの毎月の積立額にできるか */
  maxPlan(f: FundId): number {
    return Math.max(0, this.monthlyIncome - (this.planTotal - this.holding(f).plan));
  }

  /** 毎月の積立額を変える（余裕資金の範囲まで） */
  setPlan(month: number, f: FundId, amount: number): TradeRecord | null {
    const h = this.holding(f);
    const next = Math.max(0, Math.min(amount, this.maxPlan(f)));
    if (next === h.plan) return null;
    h.plan = next;
    if (next > 0) {
      h.lastPlan = next;
      this.markRestart(f);
    }
    const rec: TradeRecord = { month, type: 'plan', fund: f, price: this.price(f, month), amount: next };
    this.trades.push(rec);
    return rec;
  }

  /** 生活防衛資金から amount 円でまとめ買い（生活防衛資金の残高と NISA の枠の範囲まで） */
  buy(month: number, f: FundId, amount: number): TradeRecord | null {
    const bought = this.purchase(f, month, Math.min(amount, Math.max(0, this.emergency)));
    if (bought <= 0) return null;
    this.emergency -= bought;
    this.markRestart(f);
    const rec: TradeRecord = { month, type: 'buy', fund: f, price: this.price(f, month), amount: bought };
    this.trades.push(rec);
    return rec;
  }

  /** 売って止めたファンドの積立を、売る前の積立額で再開する（fund 省略で全部。余裕資金の範囲まで） */
  resume(month: number, fund?: FundId): TradeRecord[] {
    const targets = (fund ? [fund] : this.funds).filter((f) => this.holding(f).stoppedBySale && this.holding(f).plan === 0);
    const recs: TradeRecord[] = [];
    for (const f of targets) {
      const rec = this.setPlan(month, f, this.holding(f).lastPlan);
      if (rec) recs.push({ ...rec, type: 'resume' });
    }
    return recs;
  }

  apply(a: PlayerAction): TradeRecord[] {
    switch (a.type) {
      case 'letGo':
        return this.sell(a.month, 'letGo');
      case 'sell':
        return this.sell(a.month, 'sell', a.fund);
      case 'resume':
        return this.resume(a.month, a.fund);
      case 'plan': {
        if (!a.fund) return [];
        const r = this.setPlan(a.month, a.fund, a.amount ?? 0);
        return r ? [r] : [];
      }
      case 'buy': {
        if (!a.fund) return [];
        const r = this.buy(a.month, a.fund, a.amount ?? 0);
        return r ? [r] : [];
      }
    }
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
  /** 最後に NISA に何か入っている（または積立している） */
  endedInvested: boolean;
  /** NISA の上限に届いて買えずに生活防衛資金に残った額 */
  overCapTotal: number;
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
  const touched = pf.funds.filter((f) => pf.holding(f).contributed > 0 || (pf.allocation.invest[f] ?? 0) > 0);
  const byFund = touched.map((f): FundSummary => {
    const h = pf.holding(f);
    const v = pf.fundValue(f, last);
    return {
      fund: f,
      finalValue: v,
      contributed: h.contributed,
      withdrawn: h.withdrawn,
      profit: v + h.withdrawn - h.contributed,
      fee: h.fee,
      endedActive: pf.isActive(f),
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
    endedInvested: pf.invested,
    emergencyFinal: pf.emergency,
    overCapTotal: pf.overCapTotal,
    byFund,
    trades: pf.trades.slice(),
    eventOutcomes: pf.eventOutcomes.slice(),
  };
}
