// 暴落中に主人公へ飛んでくる「誘惑」（悲鳴コメント）。描画には依存しないロジックだけを持つ。
// - 誘惑（bad）は主人公に当たると握力を大きく減らす。払いのけると少し回復
// - 役に立つ言葉（good）は届くと握力が回復する。払いのけてしまうと減る

import { CONFIG, type Config } from '../config';
import { COMMENTS, GOOD_WORDS, commentTier } from './comments';

export type TemptationKind = 'bad' | 'good';

export interface Temptation {
  id: number;
  text: string;
  kind: TemptationKind;
  /** 下落の段階（0〜2） */
  tier: number;
  x: number;
  y: number;
  speed: number;
  state: 'fly' | 'popped' | 'hit' | 'fade';
  /** popped / hit / fade になってからの秒数（演出用） */
  age: number;
}

export interface TemptationStep {
  /** 主人公に当たった誘惑 */
  hits: Temptation[];
  /** 主人公に届いた役に立つ言葉 */
  arrivals: Temptation[];
}

/** 画面の右端の外から飛んでくる */
const SPAWN_X = 372;
const SPAWN_Y_MIN = 130;
const SPAWN_Y_MAX = 470;
/** 主人公からこの距離まで来たら当たり */
const HIT_DISTANCE = 18;
/** 当たり・払いのけ後に消えるまでの秒数 */
const LINGER_SEC = 0.35;

export class Temptations {
  list: Temptation[] = [];
  private acc = 0;
  private nextId = 1;

  constructor(
    private readonly rand: () => number = Math.random,
    private readonly cfg: Config = CONFIG,
  ) {}

  update(dtSec: number, drawdown: number, heroX: number, heroY: number): TemptationStep {
    const tc = this.cfg.temptations;
    const tier = commentTier(drawdown, this.cfg.effects.commentTiers);
    const step: TemptationStep = { hits: [], arrivals: [] };

    // 出現
    if (tier >= 0) {
      this.acc += tc.spawnPerSec[tier] * dtSec;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.flying().length < tc.maxOnScreen) this.spawn(tier);
      }
    } else this.acc = 0;

    for (const t of this.list) {
      if (t.state !== 'fly') {
        t.age += dtSec;
        continue;
      }
      // 下落が落ち着いたら、飛んでいるものは消えていく
      if (tier < 0) {
        t.state = 'fade';
        continue;
      }
      // 主人公に向かってまっすぐ飛ぶ（横は一定の速さ、縦は着くまでに主人公の高さへ寄せる）
      const remain = Math.max(1, t.x - heroX);
      const dx = Math.min(remain, t.speed * dtSec);
      t.y += (heroY - t.y) * (dx / remain);
      t.x -= dx;
      if (t.x - heroX <= HIT_DISTANCE) {
        t.state = 'hit';
        if (t.kind === 'bad') step.hits.push(t);
        else step.arrivals.push(t);
      }
    }
    this.list = this.list.filter((t) => t.state === 'fly' || t.age < LINGER_SEC);
    return step;
  }

  private spawn(tier: number): void {
    const tc = this.cfg.temptations;
    const good = this.rand() < tc.goodRatio;
    const words = good ? GOOD_WORDS : COMMENTS[tier];
    this.list.push({
      id: this.nextId++,
      text: words[Math.floor(this.rand() * words.length)],
      kind: good ? 'good' : 'bad',
      tier,
      x: SPAWN_X,
      y: SPAWN_Y_MIN + this.rand() * (SPAWN_Y_MAX - SPAWN_Y_MIN),
      speed: tc.speed[tier] * (0.85 + this.rand() * 0.3),
      state: 'fly',
      age: 0,
    });
  }

  flying(): Temptation[] {
    return this.list.filter((t) => t.state === 'fly');
  }

  /** 払いのける。飛んでいなければ null */
  pop(id: number): Temptation | null {
    const t = this.list.find((x) => x.id === id && x.state === 'fly');
    if (!t) return null;
    t.state = 'popped';
    return t;
  }

  /** いちばん主人公に近いものを払いのける（PC のスペースキー） */
  popFront(): Temptation | null {
    const f = this.flying().sort((a, b) => a.x - b.x)[0];
    return f ? this.pop(f.id) : null;
  }

  clear(): void {
    this.list = [];
    this.acc = 0;
  }
}
