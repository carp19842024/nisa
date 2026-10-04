// 長押しボタン（誤操作防止）。長押しの途中で指を離すとキャンセル。
// onTap を渡すと、長押しにならずに短く押して離したときに onTap を呼ぶ。
// canHold() が false のときは長押しを受け付けず、押した瞬間に onTap を呼ぶ。

export interface HoldButton {
  press(): void;
  /** 指を離した（短く押しただけなら onTap） */
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
      const wasShort = start > 0;
      api.reset();
      if (wasShort) opts.onTap?.();
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
  btn.addEventListener('pointerup', () => api.release());
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    btn.addEventListener(type, () => api.reset());
  }
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return api;
}
