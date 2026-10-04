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

  /**
   * 画面下のファンドごとのボタン（全ファンド）。
   * 長押し＝そのファンドを売る、タップ＝そのファンドの設定（積立額の変更・まとめ買い。持っていないファンドも始められる）
   */
  setupChips(game: Game, onSell: (f: FundId) => void, onConfigure: (f: FundId) => void): void {
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
        canHold: () => game.portfolio.isActive(fund),
        onTap: () => onConfigure(fund),
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
    const profit = game.nisaValue + pf.withdrawn - pf.contributed;
    const rate = pf.contributed > 0 ? profit / pf.contributed : 0;
    const e = this.els;

    const stopped = pf.funds.filter((f) => pf.holding(f).stoppedBySale && !pf.isActive(f)).length;
    const activeCount = pf.funds.filter((f) => pf.isActive(f)).length;
    const state = !pf.invested ? 'NISA停止中' : stopped > 0 ? `${stopped}本 売却中` : `NISA ${activeCount}本`;
    this.set('date', e.date, monthLabel(Math.min(game.currentMonth, CONFIG.months - 1)));
    this.set('state', e.state, state, stopped === 0 ? 'state-chip' : 'state-chip sold');
    this.set('value', e.value, man(game.nisaValue));
    this.set('principal', e.principal, man(pf.contributed));
    this.set('profit', e.profit, pctSigned(rate), signClass(profit));
    this.set('emergency', e.emergency, man(pf.emergency), pf.emergency < 0 ? 'minus' : '');

    // 売ったファンドがあるとき：資産の合計（NISA＋生活防衛資金）と、売らずに持っていたらとの差
    show(e.hold, stopped > 0);
    if (stopped > 0) {
      const total = game.totalAssets;
      const diff = total - game.holdTotalAssets;
      this.set('cash', e.cash, man(total));
      this.set('holdDiff', e.holdDiff, `差 ${manSigned(diff)}`, signClass(diff));
    }

    for (const c of this.chips) {
      const h = pf.holding(c.fund);
      const active = pf.isActive(c.fund);
      const planText = h.plan > 0 ? `月${man(h.plan, 0)}` : '積立なし';
      const v = h.units > 0 ? man(game.fundValue(c.fund)) : active ? '来月から' : h.stoppedBySale ? '売却済み' : '未購入';
      const act = active ? planText : h.stoppedBySale ? 'タップで再開' : 'タップで追加';
      this.set(`chipv-${c.fund}`, c.el.querySelector<HTMLElement>('.chip-val')!, v);
      this.set(`chipa-${c.fund}`, c.el.querySelector<HTMLElement>('.chip-act')!, act);
      c.el.classList.toggle('stopped', !active);
      // 全部売っている間は、再開できることが分かるようにボタンを点滅させる
      c.el.classList.toggle('beckon', !active && h.stoppedBySale && !game.invested);
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

  /**
   * ファンドの設定画面：毎月の積立額と、生活防衛資金からのまとめ買い。
   * NISA の年間・生涯の購入上限の残りも表示する
   */
  showFundSettings(game: Game, fund: FundId, onConfirm: (plan: number, lump: number) => void, onCancel: () => void): void {
    const m = this.els.modal;
    const pf = game.portfolio;
    const h = pf.holding(fund);
    const def = fundDef(fund);
    const unit = 10_000;
    const q = pf.quota();
    const maxPlan = pf.maxPlan(fund);
    const maxLump = Math.max(0, Math.min(pf.emergency, q.left));
    const sold = game.lastSaleAmount(fund);
    const restarting = h.stoppedBySale && h.plan === 0;
    let plan = restarting ? Math.min(h.lastPlan, maxPlan) : h.plan;
    let lump = restarting ? Math.min(Math.floor(sold / unit) * unit, Math.floor(maxLump / unit) * unit) : 0;
    const otherPlans = pf.planTotal - h.plan;

    m.innerHTML = `
      <div class="modal-card buyback" style="--fund:${def.color}">
        <h2>${escapeHtml(def.name)}</h2>
        <p class="small">${escapeHtml(def.desc)}</p>
        <div class="pay-list">
          ${h.units > 0 ? `<div><span>評価額</span><span>${man(game.fundValue(fund))}</span></div>` : ''}
          <div><span>生活防衛資金</span><span>${man(pf.emergency)}</span></div>
          <div><span>NISA枠 今年あと</span><span>${man(q.annualLeft)}</span></div>
          <div><span>NISA枠 生涯あと</span><span>${man(q.lifetimeLeft)}</span></div>
        </div>
        <p class="setting-label">毎月の積立額</p>
        <div class="amount-row">
          <button type="button" data-p="-10000">−1万</button>
          <b id="fs-plan"></b>
          <button type="button" data-p="10000">＋1万</button>
        </div>
        <p class="small" id="fs-plan-note"></p>
        <p class="setting-label">まとめ買い（生活防衛資金から）</p>
        <div class="amount-row">
          <button type="button" data-d="-100000">−10万</button>
          <button type="button" data-d="-10000">−1万</button>
          <b id="fs-lump"></b>
          <button type="button" data-d="10000">＋1万</button>
          <button type="button" data-d="100000">＋10万</button>
        </div>
        <div class="amount-quick">
          <button type="button" data-v="0">0円</button>
          ${sold > 0 ? `<button type="button" data-v="${Math.min(sold, maxLump)}">売った額</button>` : ''}
          <button type="button" data-v="${maxLump}">買える上限</button>
        </div>
        <p class="small" id="fs-left"></p>
        <button class="btn primary" id="fs-ok" type="button">決定</button>
        <button class="btn ghost" id="fs-cancel" type="button">やめる</button>
      </div>`;
    const planEl = m.querySelector<HTMLElement>('#fs-plan')!;
    const planNote = m.querySelector<HTMLElement>('#fs-plan-note')!;
    const lumpEl = m.querySelector<HTMLElement>('#fs-lump')!;
    const leftEl = m.querySelector<HTMLElement>('#fs-left')!;
    const update = () => {
      planEl.textContent = man(plan, 0);
      const save = pf.monthlyIncome - otherPlans - plan;
      planNote.textContent =
        maxPlan <= plan && plan < pf.monthlyIncome
          ? `毎月の貯金：${man(save, 0)}（増やすには、ほかのファンドの積立額を減らす）`
          : `毎月の貯金：${man(save, 0)}`;
      lumpEl.textContent = man(lump);
      const capNote = maxLump < pf.emergency ? '（NISA枠の上限まで）' : '';
      leftEl.textContent = `まとめ買い後の生活防衛資金：${man(pf.emergency - lump)}${capNote}`;
    };
    m.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) =>
      b.addEventListener('click', () => {
        plan = Math.max(0, Math.min(maxPlan, plan + Number(b.dataset.p)));
        update();
      }),
    );
    m.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) =>
      b.addEventListener('click', () => {
        lump = Math.max(0, Math.min(maxLump, lump + Number(b.dataset.d)));
        update();
      }),
    );
    m.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
      b.addEventListener('click', () => {
        lump = Math.max(0, Math.min(maxLump, Number(b.dataset.v)));
        update();
      }),
    );
    m.querySelector('#fs-ok')!.addEventListener('click', () => {
      show(m, false);
      onConfirm(plan, lump);
    });
    m.querySelector('#fs-cancel')!.addEventListener('click', () => {
      show(m, false);
      onCancel();
    });
    update();
    show(m, true);
  }

  get modalOpen(): boolean {
    return !this.els.modal.classList.contains('hidden');
  }

  /** 売買・積立額の変更の通知 */
  trade(type: TradeRecord['type'], recs: TradeRecord[]): void {
    const amount = recs.reduce((s, r) => s + r.amount, 0);
    const names = recs.map((r) => fundDef(r.fund).short).join('・');
    if (type === 'letGo')
      this.banner(`握力が尽きた…手を離して全部売却。${man(amount)}は生活防衛資金へ。下のボタンから再開できる`, 'bad', 3.5);
    else if (type === 'sell') this.banner(`${names}を売って生活防衛資金へ（${man(amount)}）。積立も止めた`, 'bad', 2.8);
    else if (type === 'buy') this.banner(`${names}を${man(amount)}まとめ買い！`, 'good');
    else if (type === 'resume') this.banner(`${names}の積立を再開！`, 'good');
    else this.banner(amount > 0 ? `${names}の積立を毎月${man(amount, 0)}に` : `${names}の積立を止めた`, 'normal', 1.8);
  }
}

export function fundDef(f: FundId): FundConfig {
  const d = CONFIG.funds.find((x) => x.id === f);
  if (!d) throw new Error(`unknown fund ${f}`);
  return d;
}
