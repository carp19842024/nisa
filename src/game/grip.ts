// 握力。ドローダウンが深く、下落が急なほど速く減る。タップで回復する。

import { CONFIG, type Config } from '../config';

/** 1秒あたりの減少量。しきい値以下なら 0 */
export function gripDecayPerSec(drawdown: number, monthDrop: number, cfg: Config = CONFIG): number {
  const g = cfg.grip;
  if (drawdown <= g.drawdownThreshold) return 0;
  return g.decayCoef * drawdown * (g.steepFloor + Math.max(0, monthDrop));
}

export class Grip {
  value: number;

  constructor(private readonly cfg: Config = CONFIG) {
    this.value = cfg.grip.max;
  }

  /** 握力を時間経過で更新する。尽きたら true */
  update(dtSec: number, drawdown: number, monthDrop: number): boolean {
    const g = this.cfg.grip;
    const decay = gripDecayPerSec(drawdown, monthDrop, this.cfg);
    if (decay > 0) this.value -= decay * dtSec;
    else this.value = Math.min(g.max, this.value + g.regenPerSec * dtSec);
    if (this.value <= 0) {
      this.value = 0;
      return true;
    }
    return false;
  }

  tap(): void {
    this.value = Math.min(this.cfg.grip.max, this.value + this.cfg.grip.tapRecover);
  }

  reset(): void {
    this.value = this.cfg.grip.max;
  }
}
