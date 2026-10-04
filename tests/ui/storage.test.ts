import { afterEach, describe, expect, it, vi } from 'vitest';

const score = (v: number) => ({ finalValue: v, profit: 0, title: 'テスト', seed: 1 });

describe('ハイスコアの保存', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('localStorage が使えないときも、開いている間は更新・表示される', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const st = await import('../../src/ui/storage');
    expect(st.load().highScore).toBeUndefined();
    expect(st.submitScore(score(100))).toBe(true);
    expect(st.load().highScore?.finalValue).toBe(100);
    expect(st.submitScore(score(50))).toBe(false);
    expect(st.submitScore(score(200))).toBe(true);
    expect(st.load().highScore?.finalValue).toBe(200);
  });

  it('localStorage が使えるときは、そこに保存して読み戻す', async () => {
    const box = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
    });
    const st = await import('../../src/ui/storage');
    st.submitScore(score(300));
    expect(box.size).toBe(1);
    vi.resetModules();
    const fresh = await import('../../src/ui/storage');
    expect(fresh.load().highScore?.finalValue).toBe(300);
  });
});
