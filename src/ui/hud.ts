// 本編中の HTML 部分：HUD、コメント、バナー、ライフイベントのモーダル

import { CONFIG, type FundConfig, type FundId } from '../config';
import { COMMENTS, commentTier } from '../game/comments';
import type { Game } from '../game/loop';
import type { Overlay } from '../game/renderer';
import type { SpriteSet } from '../game/sprites';
import type { LifeEventOutcome, TradeRecord } from '../sim/portfolio';
import { $, show, spriteCanvas } from './dom';
import { setupHoldButton, type HoldButton } from './hold';
import { escapeHtml, man, manSigned, monthLabel, pctSigned, signClass } from './format';

export class Hud {
  private readonly els = {
    hud: $('hud'),
    date: $('hud-date'),
    state: $('hud-state'),
    value: $('hud-value'),
    principal: $('hud-principal'),
    profit: $('hud-profit'),
    emergency: $('hud-emergency'),
    hold: $('hud-hold'),
    cash: $('hud-cash'),
    holdDiff: $('hud-hold-diff'),
    gripFill: $('grip-fill'),
    dd: $('hud-dd'),
    comments: $('comments'),
    peakLabel: $('peak-label'),
    tapPrompt: $('tap-prompt'),
    banner: $('banner'),
    controls: $('controls'),
    chips: $('fund-chips'),
    modal: $('modal'),
  };
  private last: Record<string, string> = {};
  private commentAcc = 0;
  private bannerTimer = 0;
  private chips: { fund: FundId; el: HTMLElement; hold: HoldButton }[] = [];

  constructor(private sprites: SpriteSet) {}

  setSprites(s: SpriteSet): void {
    this.sprites = s;
  }

  showGameUi(visible: boolean): void {
    show(this.els.hud, visible);
    show(this.els.controls, visible);
    if (!visible) {
      show(this.els.peakLabel, false);
      show(this.els.tapPrompt, false);
      show(this.els.banner, false);
      show(this.els.modal, false);
      this.clearComments();
    }
  }

  private set(key: string, el: HTMLElement, text: string, cls?: string): void {
    const k = `${text}|${cls ?? ''}`;
    if (this.last[key] === k) return;
    this.last[key] = k;
    el.textContent = text;
    if (cls !== undefined) el.className = cls;
  }

  /** 画面下のファンドごとのボタン。積立中は長押しで売る、停止中は押すと再開 */
  setupChips(game: Game, onSell: (f: FundId) => void, onBuy: (f: FundId) => void): void {
    this.resetHolds();
    this.last = {};
    const box = this.els.chips;
    box.replaceChildren();
    this.chips = game.portfolio.funds.map((fund) => {
      const def = fundDef(fund);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'fund-chip';
      el.style.setProperty('--fund', def.color);
      el.innerHTML = `<span class="hold-fill"></span><span class="chip-name"></span><span class="chip-val"></span><span class="chip-act"></span>`;
      el.querySelector('.chip-name')!.textContent = def.short;
      const hold = setupHoldButton(el, CONFIG.controls.sellHoldMs, () => onSell(fund), {
        canHold: () => game.portfolio.holding(fund).active,
        onTap: () => onBuy(fund),
      });
      box.appendChild(el);
      return { fund, el, hold };
    });
    box.style.setProperty('--n', String(this.chips.length));
  }

  /** キーボード用：i 番目のファンドボタン */
  chip(i: number): HoldButton | null {
    return this.chips[i]?.hold ?? null;
  }

  resetHolds(): void {
    for (const c of this.chips) c.hold.reset();
  }

  update(game: Game, overlay: Overlay, dtSec: number): void {
    const pf = game.portfolio;
    const value = game.value;
    const profit = value + pf.withdrawn - pf.contributed;
    const rate = pf.contributed > 0 ? profit / pf.contributed : 0;
    const e = this.els;

    const stopped = pf.funds.filter((f) => !pf.holding(f).active).length;
    const state = stopped === 0 ? 'NISA積立中' : stopped === pf.funds.length ? 'NISA停止中（貯金）' : `${stopped}本 停止中`;
    this.set('date', e.date, monthLabel(Math.min(game.currentMonth, CONFIG.months - 1)));
    this.set('state', e.state, state, stopped === 0 ? 'state-chip' : 'state-chip sold');
    this.set('value', e.value, man(game.nisaValue));
    this.set('principal', e.principal, man(pf.contributed));
    this.set('profit', e.profit, pctSigned(rate), signClass(profit));
    this.set('emergency', e.emergency, man(pf.emergency), pf.emergency < 0 ? 'minus' : '');

    // 売ったファンドがあるとき：移した貯金と、売らずに持っていたらとの差
    show(e.hold, stopped > 0);
    if (stopped > 0) {
      const diff = value - game.holdValue;
      this.set('cash', e.cash, man(pf.cash));
      this.set('holdDiff', e.holdDiff, `差 ${manSigned(diff)}`, signClass(diff));
    }

    for (const c of this.chips) {
      const h = pf.holding(c.fund);
      const v = h.active ? man(game.fundValue(c.fund)) : `貯金 ${man(h.cash)}`;
      this.set(`chipv-${c.fund}`, c.el.querySelector<HTMLElement>('.chip-val')!, v);
      this.set(`chipa-${c.fund}`, c.el.querySelector<HTMLElement>('.chip-act')!, h.active ? '長押しで売る' : '押すと再開');
      c.el.classList.toggle('stopped', !h.active);
    }

    const g = game.grip.value / CONFIG.grip.max;
    e.gripFill.style.width = `${Math.round(g * 100)}%`;
    this.set('grip', e.gripFill, '', g >= 0.5 ? '' : g >= 0.3 ? 'mid' : 'low');
    this.set('dd', e.dd, game.drawdown > 0.01 ? `高値${pctSigned(-game.drawdown, 0)}` : '');

    // 前の高値ラベル・連打の指示
    if (overlay.peakLabelY !== null) {
      e.peakLabel.style.top = `${overlay.peakLabelY - 14}px`;
      show(e.peakLabel, true);
    } else show(e.peakLabel, false);
    const running = !game.paused && !game.userPaused && !game.finished;
    show(e.tapPrompt, running && game.invested && game.inDrawdown);

    // 流れるコメント
    e.comments.classList.toggle('paused', !running);
    if (running) {
      const tier = commentTier(game.drawdown, CONFIG.effects.commentTiers);
      if (tier >= 0) {
        this.commentAcc += CONFIG.effects.commentRatePerSec[tier] * dtSec;
        while (this.commentAcc >= 1) {
          this.commentAcc -= 1;
          if (e.comments.childElementCount < CONFIG.effects.commentMax) this.spawnComment(tier);
        }
      } else this.commentAcc = 0;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dtSec;
      if (this.bannerTimer <= 0) show(e.banner, false);
    }
  }

  private spawnComment(tier: number): void {
    // 深い段階でも、たまに浅い段階のコメントを混ぜる
    const t = Math.random() < 0.75 ? tier : Math.floor(Math.random() * (tier + 1));
    const list = COMMENTS[t];
    const span = document.createElement('span');
    span.className = `comment t${t}`;
    span.textContent = list[Math.floor(Math.random() * list.length)];
    const dur = CONFIG.effects.commentDurationSec[tier] * (0.8 + Math.random() * 0.4);
    span.style.top = `${120 + Math.random() * 340}px`;
    span.style.fontSize = `${12 + t * 2 + Math.floor(Math.random() * 3)}px`;
    span.style.animationDuration = `${dur}s`;
    span.addEventListener('animationend', () => span.remove());
    this.els.comments.appendChild(span);
  }

  clearComments(): void {
    this.els.comments.replaceChildren();
    this.commentAcc = 0;
  }

  banner(text: string, kind: 'normal' | 'good' | 'bad' = 'normal', sec = 2): void {
    const b = this.els.banner;
    b.textContent = text;
    b.className = `banner ${kind === 'normal' ? '' : kind}`;
    // アニメーションを毎回やり直す
    void b.offsetWidth;
    show(b, true);
    this.bannerTimer = sec;
  }

  /** ライフイベントのモーダル。OK で onClose */
  showLifeEvent(o: LifeEventOutcome, onClose: () => void): void {
    const m = this.els.modal;
    const bad = o.forcedSale > 0 || o.debt > 0;
    const rows: string[] = [];
    if (o.fromEmergency > 0) rows.push(`<div><span>生活防衛資金から</span><span>${man(o.fromEmergency)}</span></div>`);
    if (o.fromCash > 0) rows.push(`<div><span>NISAから移した貯金から</span><span>${man(o.fromCash)}</span></div>`);
    for (const [f, amt] of Object.entries(o.forcedByFund)) {
      rows.push(`<div class="minus"><span>${escapeHtml(fundDef(f as FundId).short)}を強制売却</span><span>${man(amt!)}</span></div>`);
    }
    if (o.debt > 0) rows.push(`<div class="minus"><span>足りずに借金</span><span>${man(o.debt)}</span></div>`);

    let comment = '生活防衛資金で払えた。貯金しておいてよかった…！';
    if (o.forcedSale > 0) {
      comment =
        o.drawdown >= 0.1
          ? `防衛資金が足りず、暴落中（高値から${pctSigned(-o.drawdown, 0)}）のファンドを売るはめに…`
          : '防衛資金が足りず、ファンドを売って払った。';
    } else if (o.debt > 0) comment = 'お金が足りない…！';
    else if (o.fromCash > 0) comment = 'NISAから移した貯金で払った。';

    m.innerHTML = `
      <div class="modal-card ${bad ? 'bad' : ''}">
        <h2>ライフイベント発生</h2>
        <div id="ev-face"></div>
        <div class="event-name">${escapeHtml(o.event.name)}</div>
        <div>必要なお金：<b>${man(o.event.cost)}</b></div>
        <div class="pay-list">${rows.join('')}</div>
        <p class="small">${comment}</p>
        <button class="btn primary" id="ev-ok" type="button" disabled>しかたない…</button>
      </div>`;
    m.querySelector('#ev-face')!.appendChild(spriteCanvas(this.sprites, bad ? 'sad' : 'shock', 1.5));
    const ok = m.querySelector<HTMLButtonElement>('#ev-ok')!;
    // 連打中の誤タップで閉じないよう、少し待ってから押せるようにする
    setTimeout(() => (ok.disabled = false), 700);
    ok.addEventListener('click', () => {
      show(m, false);
      onClose();
    });
    show(m, true);
  }

  get modalOpen(): boolean {
    return !this.els.modal.classList.contains('hidden');
  }

  /** 売却（NISA→貯金）・買い直し（NISA再開）の通知 */
  trade(type: 'sell' | 'letGo' | 'buy', recs: TradeRecord[]): void {
    const amount = recs.reduce((s, r) => s + r.amount, 0);
    const names = recs.map((r) => fundDef(r.fund).short).join('・');
    if (type === 'letGo') this.banner(`握力が尽きた…手を離して全部売却。${man(amount)}を貯金へ`, 'bad', 3);
    else if (type === 'sell') this.banner(`${names}を売って貯金へ（${man(amount)}）。以降の積立分も貯金に回る`, 'bad', 2.8);
    else this.banner(`${names}を再開！ 移していた${man(amount)}で買い直した`, 'good');
  }
}

export function fundDef(f: FundId): FundConfig {
  const d = CONFIG.funds.find((x) => x.id === f);
  if (!d) throw new Error(`unknown fund ${f}`);
  return d;
}
