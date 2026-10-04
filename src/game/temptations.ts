// 暴落中に右から左へ流れてくる「誘惑」（悲鳴コメント）。描画には依存しないロジックだけを持つ。
// コメントはまっすぐ横に流れ、主人公の位置（縦のライン）を越えた瞬間に効果が出る。
// - 誘惑（bad）がラインを越えると握力が減る。越える前に払いのけると少し回復
// - 役に立つ言葉（good）がラインを越えると握力が回復する。払いのけてしまうと減る

import { CONFIG, type Config } from '../config';
import { COMMENTS, GOOD_WORDS, commentTier } from './comments';

export type TemptationKind = 'bad' | 'good';

export interface Temptation {
  id: number;
  text: string;
  kind: TemptationKind;
  /** 下落の段階（0〜2） */
  tier: number;
  /** 左端の位置 */
  x: number;
  y: number;
  speed: number;
  /** fly = 流れている（払える）／passed = ラインを越えて流れ去る途中／popped = 払いのけた／fade = 下落が落ち着いて消える */
  state: 'fly' | 'passed' | 'popped' | 'fade';
  /** popped / hit / fade になってからの秒数（演出用） */
  age: number;
}

export interface TemptationStep {
  /** 主人公のラインを越えた誘惑 */
  hits: Temptation[];
  /** 主人公のラインを越えた役に立つ言葉 */
  arrivals: Temptation[];
}

/** 画面の右端の外から飛んでくる */
const SPAWN_X = 372;
const SPAWN_Y_MIN = 125;
const SPAWN_Y_MAX = 480;
/** 画面の左端からこれだけ外に出たら消す（長い文言でも抜けきる位置） */
const GONE_X = -320;
/** 払いのけ・消える演出の秒数 */
const LINGER_SEC = 0.35;

export class Temptations {
  list: Temptation[] = [];
  private acc = 0;
  private nextId = 1;

  constructor(
    private readonly rand: () => number = Math.random,
    private readonly cfg: Config = CONFIG,
  ) {}

  /** heroX：主人公の縦のライン（これを越えると効果が出る） */
  update(dtSec: number, drawdown: number, heroX: number): TemptationStep {
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
      if (t.state === 'popped' || t.state === 'fade') {
        t.age += dtSec;
        continue;
      }
      // 下落が落ち着いたら、まだ越えていないものは消えていく
      if (tier < 0 && t.state === 'fly') {
        t.state = 'fade';
        continue;
      }
      // まっすぐ右から左へ流れる。主人公のラインを越えた瞬間に効果
      t.x -= t.speed * dtSec;
      if (t.state === 'fly' && t.x <= heroX) {
        t.state = 'passed';
        if (t.kind === 'bad') step.hits.push(t);
        else step.arrivals.push(t);
      }
    }
    this.list = this.list.filter((t) =>
      t.state === 'fly' || t.state === 'passed' ? t.x > GONE_X : t.age < LINGER_SEC,
    );
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

  clear(): void {
    this.list = [];
    this.acc = 0;
  }
}
