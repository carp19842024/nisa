// ゲームループ：時間の進み、月初処理、握力、主人公の状態。
// 実際のお金の計算は sim/portfolio に任せ、ここでは「いつ・何をしたか」を操作ログに残す。

import { CONFIG, type Config, type FundId } from '../config';
import { scheduleLifeEvents, type LifeEvent } from '../sim/events';
import {
  fundPrices,
  generateMarket,
  priceAt,
  type FundBustInstance,
  type Market,
  type ScenarioInstance,
} from '../sim/market';
import {
  Portfolio,
  type Allocation,
  type LifeEventOutcome,
  type PlayerAction,
  type TradeRecord,
} from '../sim/portfolio';
import { audio } from './audio';
import { Grip } from './grip';
import { Temptations, type Temptation } from './temptations';

export type HeroPose = 'run' | 'runHappy' | 'shock' | 'cling' | 'clingCry' | 'fall' | 'walk' | 'victory';

export interface GameCallbacks {
  /** ライフイベント発生（ゲームは一時停止済み。resume() で再開） */
  onLifeEvent(outcome: LifeEventOutcome, month: number): void;
  onScenarioStart(scenario: ScenarioInstance): void;
  onFundBust(bust: FundBustInstance): void;
  /** 売買（1回の操作で複数ファンドのこともある） */
  onTrade(type: PlayerAction['type'], records: TradeRecord[]): void;
  onCelebrate(): void;
  onEnd(actions: PlayerAction[]): void;
}

export class Game {
  readonly market: Market;
  readonly events: LifeEvent[];
  readonly portfolio: Portfolio;
  /** 同じ値動き・同じイベントで一度も売らなかった場合（売却中の比較表示用） */
  readonly holdPortfolio: Portfolio;
  readonly grip: Grip;
  /** 暴落中に飛んでくる誘惑 */
  readonly temptations = new Temptations();
  /** 主人公の画面上の位置（誘惑が向かう先。描画側が毎フレーム更新する） */
  heroScreenX = 128;
  heroScreenY = 330;
  /** 誘惑に当たった直後の演出用タイマー */
  hitTimer = 0;
  readonly actions: PlayerAction[] = [];

  /** 経過時間（月・小数） */
  t = 0;
  speed = 1;
  /** イベントのモーダル表示中など */
  paused = false;
  /** プレイヤーが一時停止ボタンで止めている */
  userPaused = false;
  finished = false;
  /** 演出用の実時間（秒） */
  elapsed = 0;

  /**
   * 主人公が走る線＝「今持っているファンド全体」の値動きの指数。
   * 持ち物の構成（どのファンドをどれだけ）が変わっても線がつながるように、構成が変わるたびに基準を取り直す。
   * 全部売っているときは、積立設定の配分で持っていた場合の値動きを表示する
   */
  price: number;
  /** 月初ごとの指数（チャートの過去部分） */
  readonly history: number[] = [];
  peak: number;
  drawdown = 0;
  /** 直近1か月の下落率（上昇なら 0） */
  monthDrop = 0;
  /** 直近1か月の変化率 */
  monthChange = 0;

  shockTimer = 0;
  fallTimer = 0;
  victoryTimer = 0;
  /** 売却した時の価格（売却中の焦り判定用） */
  soldAtPrice = 0;

  private nextMonth = 0;
  private maxDrawdownSincePeak = 0;
  private wasInDrawdown = false;
  private anchor: { t: number; value: number; weights: [FundId, number][] } | null = null;

  constructor(
    readonly seed: number,
    readonly allocation: Allocation,
    private readonly cb: GameCallbacks,
    readonly cfg: Config = CONFIG,
  ) {
    this.market = generateMarket(seed, cfg);
    this.events = scheduleLifeEvents(this.market, cfg);
    this.portfolio = new Portfolio(this.market, allocation, this.events, cfg);
    this.holdPortfolio = new Portfolio(this.market, allocation, this.events, cfg);
    this.grip = new Grip(cfg);
    this.price = cfg.market.initialPrice;
    this.peak = this.price;
  }

  start(): void {
    this.processMonth(0);
  }

  get invested(): boolean {
    return this.portfolio.invested;
  }

  /** 今の月（売買はこの月の価格で行う） */
  get currentMonth(): number {
    return Math.min(Math.floor(this.t), this.cfg.months - 1);
  }

  get inDrawdown(): boolean {
    return this.drawdown > this.cfg.grip.drawdownThreshold;
  }

  /** 売却中に、売った値段より上がっていて焦っている */
  get anxious(): boolean {
    return !this.invested && (this.price > this.soldAtPrice * 1.03 || this.monthChange > 0.02);
  }

  get pose(): HeroPose {
    if (this.fallTimer > 0) return 'fall';
    if (!this.invested) return 'walk';
    if (this.victoryTimer > 0) return 'victory';
    if (this.inDrawdown) {
      if (this.shockTimer > 0) return 'shock';
      return this.grip.value >= 50 ? 'cling' : 'clingCry';
    }
    if (this.monthChange > 0.015) return 'runHappy';
    return 'run';
  }

  update(dtMs: number): void {
    const dtSec = Math.min(dtMs, this.cfg.time.maxFrameMs) / 1000;
    this.elapsed += dtSec;
    this.shockTimer = Math.max(0, this.shockTimer - dtSec);
    this.fallTimer = Math.max(0, this.fallTimer - dtSec);
    this.victoryTimer = Math.max(0, this.victoryTimer - dtSec);
    this.hitTimer = Math.max(0, this.hitTimer - dtSec);
    if (this.paused || this.userPaused || this.finished) return;

    const tc = this.cfg.time;
    const target = this.drawdown >= tc.crashSpeedDrawdown ? tc.crashSpeed : 1;
    this.speed += (target - this.speed) * Math.min(1, tc.speedLerpPerSec * dtSec);
    this.t += ((dtSec * 1000) / tc.msPerMonth) * this.speed;

    // 時間が一気に進んでも、途中の月を飛ばさずに1か月ずつ処理する（イベントが起きたらそこで止まる）
    while (this.nextMonth <= Math.floor(this.t) && this.nextMonth < this.cfg.months) {
      const m = this.nextMonth;
      if (this.processMonth(m)) {
        this.t = m;
        this.updateMetrics(dtSec);
        return;
      }
    }

    if (this.t >= this.cfg.months) {
      this.t = this.cfg.months;
      this.updateMetrics(dtSec);
      this.finished = true;
      this.cb.onEnd(this.actions.slice());
      return;
    }
    this.updateMetrics(dtSec);
  }

  /** 月初処理。イベントで止まったら true */
  private processMonth(m: number): boolean {
    const outcome = this.portfolio.startMonth(m);
    this.holdPortfolio.startMonth(m);
    this.nextMonth = m + 1;
    this.history[m] = this.indexAt(m);
    this.reanchor(m);
    const sc = this.market.scenarios.find((s) => s.startMonth === m);
    if (sc) this.cb.onScenarioStart(sc);
    for (const b of this.market.fundBusts) {
      if (b.startMonth === m && this.portfolio.holdings[b.fund]) this.cb.onFundBust(b);
    }
    if (outcome) {
      this.paused = true;
      audio.play('event');
      this.cb.onLifeEvent(outcome, m);
      return true;
    }
    return false;
  }

  private updateMetrics(dtSec: number): void {
    this.price = this.indexAt(this.t);
    const prev = this.seriesAt(this.t - 1);
    this.monthChange = this.price / prev - 1;
    this.monthDrop = Math.max(0, -this.monthChange);

    if (this.price >= this.peak) {
      if (this.maxDrawdownSincePeak >= this.cfg.effects.celebrateAfterDrawdown) {
        this.victoryTimer = 1.6;
        audio.play('celebrate');
        this.cb.onCelebrate();
      }
      this.peak = this.price;
      this.maxDrawdownSincePeak = 0;
    }
    this.drawdown = 1 - this.price / this.peak;
    this.maxDrawdownSincePeak = Math.max(this.maxDrawdownSincePeak, this.drawdown);

    const inDd = this.inDrawdown;
    if (inDd && !this.wasInDrawdown && this.invested) {
      this.shockTimer = 0.9;
      audio.play('crash');
    }
    this.wasInDrawdown = inDd;

    if (this.invested) {
      let empty = this.grip.update(dtSec, this.drawdown, this.monthDrop);
      // 飛んでくる誘惑：当たると握力が大きく減り、役に立つ言葉が届くと回復する
      const tc = this.cfg.temptations;
      const step = this.temptations.update(dtSec, this.drawdown, this.heroScreenX, this.heroScreenY);
      for (const t of step.hits) {
        empty = this.grip.hit(tc.damage[t.tier]) || empty;
        this.hitTimer = 0.35;
        audio.play('crash');
      }
      for (const _ of step.arrivals) this.grip.heal(tc.goodHeal);
      if (empty) this.letGo();
    } else {
      this.grip.update(dtSec, 0, 0);
      this.temptations.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // 持ち物全体の指数

  /** 今の持ち物の構成比（時価ベース）。何も持っていなければ積立設定の配分 */
  private currentWeights(): [FundId, number][] {
    const m = this.currentMonth;
    const pf = this.portfolio;
    let ws = pf.funds.map((f): [FundId, number] => [f, pf.holding(f).units * pf.price(f, m)]);
    // 何も持っていなければ、今の積立額の比率 → それも無ければ最初の配分で描く
    if (ws.every(([, w]) => w <= 0)) ws = pf.funds.map((f): [FundId, number] => [f, pf.holding(f).plan]);
    if (ws.every(([, w]) => w <= 0)) ws = pf.funds.map((f): [FundId, number] => [f, this.allocation.invest[f] ?? 0]);
    const total = ws.reduce((s, [, w]) => s + w, 0);
    return ws.filter(([, w]) => w > 0).map(([f, w]) => [f, w / total]);
  }

  /** 時刻 t の指数（現在の構成で、基準時点から計算） */
  indexAt(t: number): number {
    const a = this.anchor;
    if (!a) return this.cfg.market.initialPrice;
    let r = 0;
    for (const [f, w] of a.weights) {
      const p = fundPrices(this.market, f);
      r += (w * priceAt(p, t)) / priceAt(p, a.t);
    }
    return a.value * r;
  }

  /** 過去も含めた指数（記録済みの月は記録から） */
  seriesAt(t: number): number {
    const last = this.history.length - 1;
    if (t <= 0) return this.history[0] ?? this.cfg.market.initialPrice;
    if (t >= last) return this.indexAt(t);
    const i = Math.floor(t);
    return this.history[i] + (this.history[i + 1] - this.history[i]) * (t - i);
  }

  private reanchor(t: number): void {
    const value = this.indexAt(t);
    this.anchor = { t, value, weights: this.currentWeights() };
  }

  /** 線の背景に薄く描く、各ファンドの値動き */
  get chartFunds(): { fund: FundId; prices: number[] }[] {
    const pf = this.portfolio;
    return pf.funds
      .filter((f) => pf.isActive(f) || pf.holding(f).contributed > 0)
      .map((f) => ({ fund: f, prices: fundPrices(this.market, f) }));
  }

  // ---------------------------------------------------------------------------
  // 操作

  /** 誘惑を払いのける。誘惑なら握力が少し回復、役に立つ言葉なら減る */
  popTemptation(id: number): Temptation | null {
    if (this.paused || this.userPaused || this.finished || !this.invested) return null;
    return this.applyPop(this.temptations.pop(id));
  }

  /** いちばん主人公に近いものを払いのける（PC のスペースキー） */
  popFrontTemptation(): Temptation | null {
    if (this.paused || this.userPaused || this.finished || !this.invested) return null;
    return this.applyPop(this.temptations.popFront());
  }

  private applyPop(t: Temptation | null): Temptation | null {
    if (!t) return null;
    const tc = this.cfg.temptations;
    if (t.kind === 'bad') this.grip.heal(tc.popHeal);
    else if (this.grip.hit(tc.goodPopPenalty)) this.letGo();
    audio.play('tap');
    return t;
  }

  private record(type: PlayerAction['type'], recs: TradeRecord[], fund?: FundId, amount?: number): boolean {
    if (recs.length === 0) return false;
    const action: PlayerAction = { month: recs[0].month, type };
    if (fund) action.fund = fund;
    if (amount !== undefined && (type === 'plan' || amount > 0)) action.amount = amount;
    this.actions.push(action);
    this.reanchor(this.t);
    this.cb.onTrade(type, recs);
    return true;
  }

  private letGo(): void {
    const recs = this.portfolio.sell(this.currentMonth, 'letGo');
    if (!this.record('letGo', recs)) return;
    this.soldAtPrice = this.price;
    this.fallTimer = 1.1;
    this.grip.reset();
    audio.play('letGo');
  }

  /** 「売る」長押し確定。fund を省略すると積立中の全部 */
  sell(fund?: FundId): void {
    if (this.paused || this.finished || !this.invested) return;
    const recs = this.portfolio.sell(this.currentMonth, 'sell', fund);
    if (!this.record('sell', recs, fund)) return;
    if (!this.invested) this.soldAtPrice = this.price;
    audio.play('sell');
  }

  /**
   * ファンドの設定：毎月の積立額を plan 円にし、生活防衛資金から lump 円でまとめ買いする。
   * 最初に選ばなかったファンドを途中から始めることもできる
   */
  configureFund(fund: FundId, plan: number, lump: number): void {
    if (this.paused || this.finished) return;
    const wasInvested = this.invested;
    const m = this.currentMonth;
    const p = this.portfolio.setPlan(m, fund, plan);
    const b = lump > 0 ? this.portfolio.buy(m, fund, lump) : null;
    const changed = [this.record('plan', p ? [p] : [], fund, p?.amount), this.record('buy', b ? [b] : [], fund, b?.amount)];
    if (!changed.some(Boolean)) return;
    if (!wasInvested) this.grip.reset();
    audio.play('buy');
  }

  /** 売って止めたファンドの積立を、売る前の積立額で全部再開（PC の B キー） */
  resumeAll(): void {
    if (this.paused || this.finished) return;
    const wasInvested = this.invested;
    const recs = this.portfolio.resume(this.currentMonth);
    if (!this.record('resume', recs)) return;
    if (!wasInvested) this.grip.reset();
    audio.play('buy');
  }

  resume(): void {
    this.paused = false;
  }

  private get valuationMonth(): number {
    return this.finished ? this.cfg.months : this.currentMonth;
  }

  /** NISA の評価額（ファンドの時価。売買と同じく今の月の基準価額で評価する） */
  get nisaValue(): number {
    return this.portfolio.nisaValue(this.valuationMonth);
  }

  /** 資産の合計（NISA の時価＋生活防衛資金） */
  get totalAssets(): number {
    return this.portfolio.totalAssets(this.valuationMonth);
  }

  fundValue(f: FundId): number {
    return this.portfolio.holding(f).units * this.portfolio.price(f, this.valuationMonth);
  }

  /** ずっと持ち続けていたらの資産の合計 */
  get holdTotalAssets(): number {
    return this.holdPortfolio.totalAssets(this.valuationMonth);
  }

  /** そのファンドを最後に売ったときの金額（再開時の買い直し額の目安） */
  lastSaleAmount(f: FundId): number {
    const t = [...this.portfolio.trades].reverse().find((r) => r.fund === f && (r.type === 'sell' || r.type === 'letGo'));
    return t?.amount ?? 0;
  }
}
