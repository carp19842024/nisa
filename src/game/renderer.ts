// Canvas 2D の描画：背景、チャート、主人公、演出（赤い縁・揺れ・紙吹雪）。

import { CONFIG } from '../config';
import { priceAt } from '../sim/market';
import type { Game, HeroPose } from './loop';
import { drawSprite, spriteFrame, type SpriteName, type SpriteSet } from './sprites';

export const VIEW_W = 360;
export const VIEW_H = 640;

const HERO_X = 128;
const HERO_Y = 300;
/** 1か月あたりの横幅（px） */
const PX_PER_MONTH = 10;
/** 対数価格1あたりの縦幅（px）。大きいほど暴落が崖になる */
const PX_PER_LOG = 330;
export const GROUND_Y = 548;
const HERO_MIN_Y = 170;
const HERO_MAX_Y = 470;

const POSE_SPRITE: Record<HeroPose, SpriteName> = {
  run: 'run',
  runHappy: 'run_happy',
  shock: 'shock',
  cling: 'cling',
  clingCry: 'cling_cry',
  fall: 'fall',
  walk: 'walk',
  victory: 'victory',
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

// 3×5 ドットの数字フォント（年の目盛り用）
const DIGITS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  Y: '101101010010010',
};

function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of text) {
    const g = DIGITS[ch];
    if (g) {
      for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
    }
    cx += 4;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export interface Overlay {
  /** 前の高値ラインのラベル位置（null なら非表示） */
  peakLabelY: number | null;
  /** 主人公の画面上の位置 */
  heroX: number;
  heroY: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private camLog = Math.log(CONFIG.market.initialPrice);
  private camInit = false;
  private particles: Particle[] = [];
  private fallFromY = HERO_Y;
  private lastPose: HeroPose = 'run';
  private readonly skyline: { x: number; w: number; h: number; windows: number[] }[];
  private readonly stars: { x: number; y: number; b: number }[];

  constructor(
    readonly canvas: HTMLCanvasElement,
    public sprites: SpriteSet,
  ) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が使えません');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;

    // 背景のビル群と星（見た目だけなので固定の擬似乱数で作る）
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    this.skyline = [];
    let x = 0;
    while (x < VIEW_W * 2) {
      const w = 18 + Math.floor(rnd() * 26);
      const h = 40 + Math.floor(rnd() * 120);
      const windows: number[] = [];
      for (let i = 0; i < 24; i++) windows.push(rnd() < 0.35 ? 1 : 0);
      this.skyline.push({ x, w, h, windows });
      x += w + 2 + Math.floor(rnd() * 6);
    }
    this.stars = Array.from({ length: 40 }, () => ({ x: rnd() * VIEW_W, y: rnd() * 260, b: rnd() }));
  }

  resetCamera(): void {
    this.camInit = false;
    this.particles = [];
  }

  burst(x: number, y: number, count: number, colors: string[]): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: -60 - Math.random() * 200,
        life: 1 + Math.random() * 0.8,
        color: colors[i % colors.length],
        size: 2 + Math.floor(Math.random() * 2),
      });
    }
  }

  celebrate(): void {
    this.burst(HERO_X, HERO_Y - 40, 70, ['#ffe066', '#8fe3c4', '#ff8fb1', '#7cc8ff', '#ffffff']);
  }

  tapFx(x: number, y: number): void {
    this.burst(x, y, 4, ['#ffffff', '#ffe066']);
  }

  // ---------------------------------------------------------------------------

  private drawBackground(drawdown: number, scroll: number, time: number): void {
    const ctx = this.ctx;
    const red = clamp01((drawdown - 0.05) / 0.4);
    // 空：上ほど暗い。下落が深いほど赤黒くなる
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const f = i / (bands - 1);
      const r = Math.round(24 + 40 * f + red * (70 + 30 * f));
      const g = Math.round(28 + 50 * f - red * (20 + 30 * f));
      const b = Math.round(70 + 70 * f - red * (30 + 50 * f));
      ctx.fillStyle = `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
      ctx.fillRect(0, Math.floor((i * GROUND_Y) / bands), VIEW_W, Math.ceil(GROUND_Y / bands) + 1);
    }
    for (const st of this.stars) {
      const tw = Math.sin(time * 2 + st.b * 10) > 0.6 ? 1 : 0.55;
      ctx.fillStyle = `rgba(255,255,255,${(0.3 + st.b * 0.5) * tw * (1 - red * 0.6)})`;
      ctx.fillRect(Math.floor(st.x), Math.floor(st.y), 1, 1);
    }
    // ビル群（ゆっくり流れる）
    const total = this.skyline[this.skyline.length - 1].x + 60;
    const off = (scroll * 0.25) % total;
    for (const b of this.skyline) {
      let bx = Math.floor(b.x - off);
      if (bx + b.w < 0) bx += total;
      if (bx > VIEW_W) continue;
      const top = GROUND_Y - b.h;
      ctx.fillStyle = red > 0.3 ? '#2a1420' : '#1f2240';
      ctx.fillRect(bx, top, b.w, b.h);
      ctx.fillStyle = red > 0.3 ? '#ff6b6b55' : '#ffe9a055';
      let wi = 0;
      for (let wy = top + 6; wy < GROUND_Y - 8; wy += 10) {
        for (let wx = bx + 4; wx < bx + b.w - 4; wx += 7) {
          if (b.windows[wi++ % b.windows.length]) ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }
  }

  private drawGround(scroll: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#3b3355';
    ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
    ctx.fillStyle = '#56507a';
    ctx.fillRect(0, GROUND_Y, VIEW_W, 3);
    ctx.fillStyle = '#2c2642';
    const off = Math.floor(scroll) % 16;
    for (let x = -off; x < VIEW_W; x += 16) ctx.fillRect(x, GROUND_Y + 8, 8, 2);
  }

  private yFor(price: number): number {
    return HERO_Y + (this.camLog - Math.log(price)) * PX_PER_LOG;
  }

  private updateCamera(price: number, dt: number): void {
    const target = Math.log(price);
    if (!this.camInit) {
      this.camLog = target;
      this.camInit = true;
    }
    // 遅れて追いかける（崖を落ちていく感じを出す）
    this.camLog += (target - this.camLog) * Math.min(1, dt * 2.2);
    // 主人公が画面外に出ないように
    const heroY = this.yFor(price);
    if (heroY < HERO_MIN_Y) this.camLog = target - (HERO_MIN_Y - HERO_Y) / PX_PER_LOG;
    if (heroY > HERO_MAX_Y) this.camLog = target + (HERO_MAX_Y - HERO_Y) / PX_PER_LOG;
  }

  /**
   * チャートを描く。series は月初ごとの値（floor(t) まで）、current は時刻 t の値。
   * fundLines は背景に薄く描く各ファンドの値動き（今の位置で主線と重なるようにそろえる）
   */
  private drawChart(
    series: readonly number[],
    t: number,
    current: number,
    peak: number,
    drawdown: number,
    fundLines: { color: string; prices: readonly number[] }[] = [],
  ): number | null {
    const ctx = this.ctx;
    const startM = Math.max(0, Math.floor(t - HERO_X / PX_PER_MONTH) - 1);
    const pts: { x: number; y: number; p: number }[] = [];
    for (let m = startM; m <= Math.floor(t) && m < series.length; m++) {
      pts.push({ x: HERO_X + (m - t) * PX_PER_MONTH, y: this.yFor(series[m]), p: series[m] });
    }
    const pt = current;
    pts.push({ x: HERO_X, y: this.yFor(pt), p: pt });

    // 年の目盛り
    for (let m = Math.ceil(t - HERO_X / PX_PER_MONTH); m <= t; m++) {
      if (m <= 0 || m % 12 !== 0) continue;
      const x = Math.round(HERO_X + (m - t) * PX_PER_MONTH);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 120; y < GROUND_Y; y += 6) ctx.fillRect(x, y, 1, 3);
      drawPixelText(ctx, `${m / 12}Y`, x + 3, GROUND_Y - 10, 'rgba(255,255,255,0.45)');
    }

    // 前の高値ライン
    let peakY: number | null = null;
    if (drawdown > 0.03) {
      peakY = Math.round(this.yFor(peak));
      if (peakY > 100 && peakY < GROUND_Y) {
        ctx.fillStyle = 'rgba(255,224,102,0.7)';
        for (let x = 0; x < VIEW_W; x += 8) ctx.fillRect(x, peakY, 4, 1);
      } else peakY = null;
    }

    // 線の下の塗り
    ctx.beginPath();
    ctx.moveTo(Math.round(pts[0].x), VIEW_H);
    for (const p of pts) ctx.lineTo(Math.round(p.x), Math.round(p.y));
    ctx.lineTo(HERO_X, VIEW_H);
    ctx.closePath();
    ctx.fillStyle = drawdown > 0.1 ? 'rgba(255,90,110,0.16)' : 'rgba(143,227,196,0.16)';
    ctx.fill();

    // 各ファンドの値動き（薄く）。2本以上持っているときだけ
    if (fundLines.length > 1) {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      for (const fl of fundLines) {
        const now = priceAt(fl.prices, t);
        ctx.strokeStyle = fl.color;
        ctx.beginPath();
        for (let m = startM; m <= Math.floor(t) + 1; m++) {
          const mm = Math.min(m, t);
          const x = Math.round(HERO_X + (mm - t) * PX_PER_MONTH);
          const y = Math.round(this.yFor((pt * priceAt(fl.prices, mm)) / now));
          if (m === startM) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 線（下がる区間は赤）
    ctx.lineWidth = 3;
    ctx.lineCap = 'square';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.strokeStyle = b.p < a.p * 0.985 ? '#ff5a6e' : b.p > a.p * 1.005 ? '#8fe3c4' : '#e8f4ff';
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x), Math.round(a.y));
      ctx.lineTo(Math.round(b.x), Math.round(b.y));
      ctx.stroke();
    }
    // 先端の光る点
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(HERO_X - 2, Math.round(this.yFor(pt)) - 2, 4, 4);
    return peakY;
  }

  private drawHero(game: Game): { x: number; y: number } {
    const ctx = this.ctx;
    const pose = game.pose;
    const sprite = this.sprites[POSE_SPRITE[pose]];
    const lineY = this.yFor(game.price);
    if (pose === 'fall' && this.lastPose !== 'fall') this.fallFromY = lineY;
    this.lastPose = pose;
    const time = game.elapsed;

    let x = HERO_X;
    let y = lineY;
    switch (pose) {
      case 'cling':
      case 'clingCry': {
        // 線にぶら下がる。握力が弱いほど大きく揺れる
        const sway = Math.sin(time * (pose === 'clingCry' ? 9 : 5)) * (pose === 'clingCry' ? 0.18 : 0.08);
        drawSprite(ctx, sprite, 0, x - 2, y - 3, 'top', sway);
        this.drawGripBar(game, x, y - 10);
        break;
      }
      case 'shock':
        drawSprite(ctx, sprite, 0, x, y + 2, 'bottom');
        this.drawGripBar(game, x, y - 72);
        break;
      case 'fall': {
        const f = 1 - game.fallTimer / 1.1;
        y = this.fallFromY + (GROUND_Y - this.fallFromY) * f * f;
        drawSprite(ctx, sprite, 0, x, y - 32, 'center', f * Math.PI * 1.5);
        break;
      }
      case 'walk': {
        y = GROUND_Y;
        drawSprite(ctx, sprite, spriteFrame(sprite, time), x, y, 'bottom');
        if (game.anxious) this.drawAnxious(x + 14, y - 70, time);
        break;
      }
      case 'victory': {
        const jump = Math.abs(Math.sin(time * 8)) * 12;
        drawSprite(ctx, sprite, 0, x, y + 2 - jump, 'bottom');
        break;
      }
      default:
        drawSprite(ctx, sprite, spriteFrame(sprite, time * Math.max(0.5, game.speed)), x, y + 2, 'bottom');
    }
    return { x, y };
  }

  private drawGripBar(game: Game, cx: number, top: number): void {
    const ctx = this.ctx;
    const w = 40;
    const x = Math.round(cx - w / 2);
    const y = Math.round(top);
    const v = game.grip.value / CONFIG.grip.max;
    ctx.fillStyle = '#000000aa';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    const low = v < 0.3;
    const blink = low && Math.floor(game.elapsed * 8) % 2 === 0;
    ctx.fillStyle = blink ? '#ffffff' : v >= 0.5 ? '#8fe3c4' : low ? '#ff5a6e' : '#ffd166';
    ctx.fillRect(x, y, Math.round(w * v), 4);
  }

  private drawAnxious(x: number, y: number, time: number): void {
    const ctx = this.ctx;
    const bob = Math.round(Math.sin(time * 10) * 1);
    // 「!?」の吹き出し
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + bob, 14, 11);
    ctx.fillRect(x + 2, y + 11 + bob, 3, 2);
    ctx.fillStyle = '#e0475b';
    ctx.fillRect(x + 3, y + 2 + bob, 2, 5);
    ctx.fillRect(x + 3, y + 8 + bob, 2, 1);
    ctx.fillRect(x + 7, y + 2 + bob, 4, 1);
    ctx.fillRect(x + 10, y + 3 + bob, 1, 2);
    ctx.fillRect(x + 8, y + 5 + bob, 2, 1);
    ctx.fillRect(x + 8, y + 8 + bob, 2, 1);
  }

  private drawRedEdge(drawdown: number, time: number): void {
    const fx = CONFIG.effects;
    let a = clamp01((drawdown - fx.redEdgeStart) / (fx.redEdgeFull - fx.redEdgeStart)) * 0.7;
    if (a <= 0) return;
    if (drawdown >= fx.blinkFrom) a *= 0.55 + 0.45 * Math.abs(Math.sin(time * 6));
    const ctx = this.ctx;
    const steps = 8;
    const band = 5;
    for (let i = 0; i < steps; i++) {
      ctx.fillStyle = `rgba(230,30,50,${(a * (steps - i)) / steps})`;
      const o = i * band;
      ctx.fillRect(o, o, VIEW_W - o * 2, band);
      ctx.fillRect(o, VIEW_H - o - band, VIEW_W - o * 2, band);
      ctx.fillRect(o, o + band, band, VIEW_H - o * 2 - band * 2);
      ctx.fillRect(VIEW_W - o - band, o + band, band, VIEW_H - o * 2 - band * 2);
    }
  }

  private updateParticles(dt: number): void {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vy += 380 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }

  /** 本編の描画 */
  renderGame(game: Game, dtSec: number): Overlay {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const dd = game.drawdown;
    const fx = CONFIG.effects;
    this.updateCamera(game.price, dtSec);

    ctx.save();
    if (dd >= fx.shakeFrom && !game.paused && !game.userPaused) {
      const amp = fx.shakeMax * clamp01((dd - fx.shakeFrom) / 0.3) + 1;
      ctx.translate(Math.round((Math.random() - 0.5) * 2 * amp), Math.round((Math.random() - 0.5) * 2 * amp));
    }
    const scroll = game.t * PX_PER_MONTH;
    this.drawBackground(dd, scroll, game.elapsed);
    this.drawGround(scroll);
    const fundLines = game.chartFunds.map((f) => ({
      color: CONFIG.funds.find((c) => c.id === f.fund)?.color ?? '#ffffff',
      prices: f.prices,
    }));
    const peakY = this.drawChart(game.history, game.t, game.price, game.peak, dd, fundLines);
    const hero = this.drawHero(game);
    this.updateParticles(dtSec);
    ctx.restore();
    this.drawRedEdge(dd, game.elapsed);
    return { peakLabelY: peakY, heroX: hero.x, heroY: hero.y };
  }

  /** タイトル画面の背景：なだらかな右肩上がりを走り続ける */
  renderAttract(time: number, dtSec: number): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const t = 20 + time * 1.3;
    const fakePrice = (m: number) => 10000 * Math.exp(m * 0.004 + Math.sin(m * 0.7) * 0.03 + Math.sin(m * 0.23) * 0.05);
    const n = Math.floor(t) + 2;
    const prices = Array.from({ length: n + 1 }, (_, m) => fakePrice(m));
    const p = priceAt(prices, t);
    this.updateCamera(p, dtSec);
    this.drawBackground(0, t * PX_PER_MONTH, time);
    this.drawGround(t * PX_PER_MONTH);
    this.drawChart(prices, t, p, p, 0);
    const sprite = this.sprites.run;
    drawSprite(ctx, sprite, spriteFrame(sprite, time), HERO_X, this.yFor(p) + 2, 'bottom');
    this.updateParticles(dtSec);
  }
}
