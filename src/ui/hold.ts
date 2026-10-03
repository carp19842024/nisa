// 長押しボタン（誤操作防止）。指を離すとキャンセル。
// canHold() が false のときは長押しではなく、押した瞬間に onTap を呼ぶ（停止中のファンドの「再開」など）。

export interface HoldButton {
  press(): void;
  release(): void;
  reset(): void;
}

export interface HoldOptions {
  canHold?: () => boolean;
  onTap?: () => void;
}

export function setupHoldButton(btn: HTMLElement, holdMs: number, onConfirm: () => void, opts: HoldOptions = {}): HoldButton {
  const fill = btn.querySelector<HTMLElement>('.hold-fill');
  let start = 0;
  let raf = 0;

  const draw = (f: number) => {
    if (fill) fill.style.width = `${Math.min(1, f) * 100}%`;
  };

  const tick = () => {
    const f = (performance.now() - start) / holdMs;
    draw(f);
    if (f >= 1) {
      api.reset();
      onConfirm();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const api: HoldButton = {
    press() {
      if (start) return;
      if (opts.canHold && !opts.canHold()) {
        opts.onTap?.();
        return;
      }
      start = performance.now();
      btn.classList.add('pressing');
      raf = requestAnimationFrame(tick);
    },
    release() {
      api.reset();
    },
    reset() {
      start = 0;
      cancelAnimationFrame(raf);
      btn.classList.remove('pressing');
      draw(0);
    },
  };

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* 古いブラウザ */
    }
    api.press();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    btn.addEventListener(type, () => api.release());
  }
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return api;
}
