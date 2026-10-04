// 小さな DOM ヘルパー

import type { SpriteName, SpriteSet } from '../game/sprites';

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el;
}

export function show(el: HTMLElement, visible = true): void {
  el.classList.toggle('hidden', !visible);
}

/**
 * スプライト1コマを、拡大した小さな canvas として作る（HTML 画面用）。
 * 元画像（hiRes）があれば、それを画面の解像度に合わせてなめらかに描く
 */
export function spriteCanvas(sprites: SpriteSet, name: SpriteName, scale = 2, frame = 0): HTMLCanvasElement {
  const sp = sprites[name];
  const w = Math.round(sp.frameW * scale);
  const h = Math.round(sp.frameH * scale);
  const c = document.createElement('canvas');
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const src = sp.hiRes?.[frame % sp.hiRes.length];
  if (src) {
    // 画面は拡大表示されているので、余裕をもって3倍の解像度で描く
    const k = Math.min(3, src.sh / h);
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.style.imageRendering = 'auto';
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.image, src.sx, src.sy, src.sw, src.sh, 0, 0, c.width, c.height);
    return c;
  }
  c.width = sp.frameW;
  c.height = sp.frameH;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sp.image, frame * sp.frameW, 0, sp.frameW, sp.frameH, 0, 0, sp.frameW, sp.frameH);
  return c;
}
