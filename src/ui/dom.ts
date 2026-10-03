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

/** スプライト1コマを、拡大した小さな canvas として作る（HTML 画面用） */
export function spriteCanvas(sprites: SpriteSet, name: SpriteName, scale = 2, frame = 0): HTMLCanvasElement {
  const sp = sprites[name];
  const c = document.createElement('canvas');
  c.width = sp.frameW;
  c.height = sp.frameH;
  c.style.width = `${sp.frameW * scale}px`;
  c.style.height = `${sp.frameH * scale}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sp.image, frame * sp.frameW, 0, sp.frameW, sp.frameH, 0, 0, sp.frameW, sp.frameH);
  return c;
}
