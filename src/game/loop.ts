// ゲームループ：時間の進み、月初処理、握力、主人公の状態。
// 実際のお金の計算は sim/portfolio に任せ、ここでは「いつ・何をしたか」を操作ログに残す。

import { CONFIG, type Config } from '../config';
import { scheduleLifeEvents, type LifeEvent } from '../sim/events';
import { generateMarket, priceAt, type Market, type ScenarioInstance } from '../sim/market';
import {
  Portfolio,
  type Allocation,
  type LifeEventOutcome,
  type PlayerAction,
  type TradeRecord,
} from '../sim/portfolio';
import { audio } from './audio';
import { Grip } from './grip';

export type HeroPose = 'run' | 'runHappy' | 'shock' | 'cling' | 'clingCry' | 'fall' | 'walk' | 'victory';

export interface GameCallbacks {
  /** ライフイベント発生（ゲームは一時停止済み。resume() で再開） */
  onLifeEvent(outcome: LifeEventOutcome, month: number): void;
  onScenarioStart(scenario: ScenarioInstance): void;
  onTrade(record: TradeRecord): void;
  onCelebrate(): void;
  onEnd(actions: PlayerAction[]): void;
}

export class Game {
  readonly market: Market;
  readonly events: LifeEvent[];
  readonly portfolio: Portfolio;
  readonly grip: Grip;
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

  price: number;
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

  constructor(
    readonly seed: number,
    readonly allocation: Allocation,
    private readonly cb: GameCallbacks,
    readonly cfg: Config = CONFIG,
  ) {
    this.market = generateMarket(seed, cfg);
    this.events = scheduleLifeEvents(this.market, cfg);
    this.portfolio = new Portfolio(this.market, allocation, this.events, cfg);
    this.grip = new Grip(cfg);
    this.price = this.market.prices[0];
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
    if (this.paused || this.userPaused || this.finished) return;

    const tc = this.cfg.time;
    const target = this.drawdown >= tc.crashSpeedDrawdown ? tc.crashSpeed : 1;
    this.speed += (target - this.speed) * Math.min(1, tc.speedLerpPerSec * dtSec);
    this.t += ((dtSec * 1000) / tc.msPerMonth) * this.speed;

    if (this.t >= this.cfg.months) {
      this.t = this.cfg.months;
      this.updateMetrics(dtSec);
      this.finished = true;
      this.cb.onEnd(this.actions.slice());
      return;
    }

    while (this.nextMonth <= Math.floor(this.t) && this.nextMonth < this.cfg.months) {
      const m = this.nextMonth;
      if (this.processMonth(m)) {
        this.t = m;
        break;
      }
    }
    this.updateMetrics(dtSec);
  }

  /** 月初処理。イベントで止まったら true */
  private processMonth(m: number): boolean {
    const outcome = this.portfolio.startMonth(m);
    this.nextMonth = m + 1;
    const sc = this.market.scenarios.find((s) => s.startMonth === m);
    if (sc) this.cb.onScenarioStart(sc);
    if (outcome) {
      this.paused = true;
      audio.play('event');
      this.cb.onLifeEvent(outcome, m);
      return true;
    }
    return false;
  }

  private updateMetrics(dtSec: number): void {
    const prices = this.market.prices;
    this.price = priceAt(prices, this.t);
    const prev = priceAt(prices, this.t - 1);
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
      const empty = this.grip.update(dtSec, this.drawdown, this.monthDrop);
      if (empty) this.letGo();
    } else {
      this.grip.update(dtSec, 0, 0);
    }
  }

  /** 画面タップ：握力回復 */
  tap(): void {
    if (this.paused || this.userPaused || this.finished || !this.invested) return;
    this.grip.tap();
    audio.play('tap');
  }

  private record(type: PlayerAction['type'], rec: TradeRecord | null): void {
    if (!rec) return;
    this.actions.push({ month: rec.month, type });
    this.cb.onTrade(rec);
  }

  private letGo(): void {
    const rec = this.portfolio.sell(this.currentMonth, 'letGo');
    if (!rec) return;
    this.soldAtPrice = rec.price;
    this.fallTimer = 1.1;
    this.grip.reset();
    audio.play('letGo');
    this.record('letGo', rec);
  }

  /** 「売る」長押し確定 */
  sell(): void {
    if (this.paused || this.finished || !this.invested) return;
    const rec = this.portfolio.sell(this.currentMonth, 'sell');
    if (!rec) return;
    this.soldAtPrice = rec.price;
    this.grip.reset();
    audio.play('sell');
    this.record('sell', rec);
  }

  /** 「買い戻す」 */
  buyBack(): void {
    if (this.paused || this.finished || this.invested) return;
    const rec = this.portfolio.buy(this.currentMonth);
    if (!rec) return;
    this.grip.reset();
    audio.play('buy');
    this.record('buy', rec);
  }

  resume(): void {
    this.paused = false;
  }

  /** HUD 用の評価額（売買と同じく、今の月の基準価額で評価する） */
  get value(): number {
    return this.portfolio.value(this.market.prices[this.finished ? this.cfg.months : this.currentMonth]);
  }
}
