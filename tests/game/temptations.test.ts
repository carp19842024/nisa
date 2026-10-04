import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config';
import { Temptations } from '../../src/game/temptations';

/** 決まった値を順に返す乱数 */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('誘惑', () => {
  it('下落が浅いうちは出てこない', () => {
    const tm = new Temptations(seq(0.5));
    for (let i = 0; i < 100; i++) tm.update(0.1, 0.05, 128, 300);
    expect(tm.list).toHaveLength(0);
  });

  it('下落中は出てきて、主人公に向かって飛び、届くと当たる', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5)); // 0.9 → 誘惑（役に立つ言葉ではない）
    tm.update(1 / CONFIG.temptations.spawnPerSec[1] + 0.01, 0.25, 128, 300);
    expect(tm.flying()).toHaveLength(1);
    const t = tm.flying()[0];
    expect(t.kind).toBe('bad');
    expect(t.tier).toBe(1);
    let hits = 0;
    for (let i = 0; i < 200 && hits === 0; i++) {
      const step = tm.update(0.05, 0.25, 128, 300);
      hits += step.hits.filter((h) => h.id === t.id).length;
    }
    expect(hits).toBe(1);
    // 当たるときには主人公の高さに来ている
    expect(t.y).toBeCloseTo(300, 0);
  });

  it('払いのけたものは当たらない', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    tm.update(2, 0.25, 128, 300);
    const t = tm.flying()[0];
    expect(tm.pop(t.id)?.id).toBe(t.id);
    expect(tm.pop(t.id)).toBeNull();
    let hits = 0;
    for (let i = 0; i < 200; i++) hits += tm.update(0.05, 0.05, 128, 300).hits.length;
    expect(hits).toBe(0);
  });

  it('役に立つ言葉は、届くと arrivals として返る', () => {
    const tm = new Temptations(seq(0.01, 0.5, 0.5, 0.5)); // 0.01 < goodRatio → 役に立つ言葉
    tm.update(2, 0.25, 128, 300);
    expect(tm.flying()[0].kind).toBe('good');
    let arrivals = 0;
    for (let i = 0; i < 200 && arrivals === 0; i++) arrivals += tm.update(0.05, 0.25, 128, 300).arrivals.length;
    expect(arrivals).toBe(1);
  });

  it('popFront はいちばん主人公に近いものを払いのける', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    tm.update(2, 0.25, 128, 300);
    tm.update(1, 0.25, 128, 300);
    tm.update(1.2, 0.25, 128, 300);
    const front = [...tm.flying()].sort((a, b) => a.x - b.x)[0];
    expect(tm.popFront()?.id).toBe(front.id);
  });

  it('下落が落ち着くと、飛んでいるものは消えていく', () => {
    const tm = new Temptations(seq(0.9, 0.5, 0.5, 0.5));
    tm.update(2, 0.25, 128, 300);
    tm.update(0.1, 0.02, 128, 300);
    expect(tm.flying()).toHaveLength(0);
  });
});
