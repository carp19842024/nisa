import { describe, expect, it } from 'vitest';
import { Temptations } from '../../src/game/temptations';

/** 決まった値を順に返す乱数 */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
const HERO_X = 128;

/** 1つ出てくるまで少しずつ時間を進める */
function spawnOne(tm: Temptations, drawdown = 0.25) {
  for (let i = 0; i < 1000 && tm.flying().length === 0; i++) tm.update(0.01, drawdown, HERO_X);
  return tm.flying()[0];
}

describe('誘惑', () => {
  it('下落が浅いうちは出てこない', () => {
    const tm = new Temptations(seq(0.5));
    for (let i = 0; i < 100; i++) tm.update(0.1, 0.05, HERO_X);
    expect(tm.list).toHaveLength(0);
  });

  it('右から左へまっすぐ流れ、主人公のラインを越えた瞬間に当たる', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5)); // 0.9 → 誘惑（役に立つ言葉ではない）
    const t = spawnOne(tm);
    expect(tm.flying()).toHaveLength(1);
    expect(t.x).toBeGreaterThan(300);
    const y0 = t.y;
    expect(t.kind).toBe('bad');
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const before = t.x;
      const step = tm.update(0.02, 0.25, HERO_X);
      if (step.hits.some((h) => h.id === t.id)) {
        hits++;
        expect(before).toBeGreaterThan(HERO_X);
        expect(t.x).toBeLessThanOrEqual(HERO_X);
      }
    }
    expect(hits).toBe(1);
    // 高さは変わらない（主人公を追いかけない）
    expect(t.y).toBe(y0);
    // 越えたあとも流れ去るまでは残り、払えない
    expect(t.state === 'passed' || !tm.list.includes(t)).toBe(true);
    expect(tm.pop(t.id)).toBeNull();
  });

  it('払いのけたものは当たらない', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    const t = spawnOne(tm);
    expect(tm.pop(t.id)?.id).toBe(t.id);
    expect(tm.pop(t.id)).toBeNull();
    let hits = 0;
    for (let i = 0; i < 300; i++) hits += tm.update(0.02, 0.05, HERO_X).hits.length;
    expect(hits).toBe(0);
  });

  it('役に立つ言葉は、ラインを越えると arrivals として返る', () => {
    const tm = new Temptations(seq(0.01, 0.5, 0.5, 0.5)); // 0.01 < goodRatio → 役に立つ言葉
    expect(spawnOne(tm).kind).toBe('good');
    let arrivals = 0;
    for (let i = 0; i < 300 && arrivals === 0; i++) arrivals += tm.update(0.02, 0.25, HERO_X).arrivals.length;
    expect(arrivals).toBe(1);
  });

  it('popFront はいちばん主人公のラインに近いものを払いのける', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    spawnOne(tm);
    for (let i = 0; i < 80; i++) tm.update(0.01, 0.25, HERO_X);
    const front = [...tm.flying()].sort((a, b) => a.x - b.x)[0];
    expect(tm.popFront()?.id).toBe(front.id);
  });

  it('下落が落ち着くと、まだ越えていないものは消えていく', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    spawnOne(tm);
    tm.update(0.1, 0.02, HERO_X);
    expect(tm.flying()).toHaveLength(0);
  });
});
