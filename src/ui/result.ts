// 結果画面

import { CONFIG, type FundId } from '../config';
import type { SpriteSet } from '../game/sprites';
import type { Market } from '../sim/market';
import type { GameResult } from '../sim/result';
import { spriteCanvas } from './dom';
import { fundDef } from './hud';
import { escapeHtml, man, manSigned, monthLabel, pctSigned, signClass } from './format';

export interface ResultHandlers {
  onRetry(): void;
  onChangeSettings(): void;
  onShare(): void;
  onTitle(): void;
}

export function renderResult(
  el: HTMLElement,
  sprites: SpriteSet,
  market: Market,
  res: GameResult,
  isHighScore: boolean,
  h: ResultHandlers,
): void {
  const a = res.actual;
  const good = a.profit > 0 && res.diffFromHold >= 0 && res.title.id !== 'lifeLoser';

  const forcedLines = a.eventOutcomes
    .filter((o) => o.forcedSale > 0)
    .map((o) => {
      const where = o.drawdown >= 0.2 ? '底値で' : o.drawdown >= 0.1 ? '下落中に' : '';
      const dd = o.drawdown >= 0.05 ? `（高値から${pctSigned(-o.drawdown, 0)}）` : '';
      const which = Object.keys(o.forcedByFund)
        .map((f) => fundDef(f as FundId).short)
        .join('・');
      return `<li>${monthLabel(o.event.month)}：「${escapeHtml(o.event.name)}」のために${where}${escapeHtml(which)}を${man(o.forcedSale)}分売った${dd}</li>`;
    });
  const debt = a.eventOutcomes.reduce((s, o) => s + o.debt, 0);

  el.className = 'screen';
  el.innerHTML = `
    <div class="title-badge"><small>あなたの称号</small><strong>${escapeHtml(res.title.name)}</strong>
      <span class="small">${escapeHtml(res.title.description)}</span></div>
    <div class="result-hero" id="r-hero"></div>
    ${isHighScore ? '<p class="highscore"><b>ハイスコア更新！</b></p>' : ''}
    <div class="card">
      <table class="result-table">
        <tr class="big"><th>最終的な資産<br><span class="small">（NISA＋生活防衛資金）</span></th><td>${man(a.totalAssets)}</td></tr>
        <tr><th>うち NISA の評価額</th><td>${man(a.finalValue)}</td></tr>
        <tr><th>うち 生活防衛資金</th><td class="${a.emergencyFinal < 0 ? 'minus' : ''}">${man(a.emergencyFinal)}</td></tr>
        <tr class="sep big"><th>ずっと持ち続けていたら<br><span class="small">（NISA＋生活防衛資金）</span></th><td>${man(res.hold.totalAssets)}</td></tr>
        <tr><th>その差額</th><td class="${signClass(res.diffFromHold)}">${manSigned(res.diffFromHold)}</td></tr>
        ${
          res.allocation.invest.zenbu === undefined || Object.keys(res.allocation.invest).length > 1
            ? `<tr><th>ぜんぶ入りファンドだけを<br>持ち続けていたら</th><td>${man(res.zenbuOnly.totalAssets)}</td></tr>`
            : ''
        }
        <tr class="sep"><th>NISA に入れたお金（積立元本）</th><td>${man(a.contributed)}</td></tr>
        ${a.withdrawn > 0 ? `<tr><th>NISA から出したお金<br><span class="small">（売却・強制売却）</span></th><td>${man(a.withdrawn)}</td></tr>` : ''}
        <tr><th>NISA の損益</th><td class="${signClass(a.profit)}">${manSigned(a.profit)}（${pctSigned(a.profitRate)}）</td></tr>
        <tr class="sep"><th>売却回数（ファンドごと）</th><td>${a.sellCount}回</td></tr>
        <tr><th>手を離した回数</th><td>${a.letGoCount}回</td></tr>
        <tr><th>NISAを再開した回数</th><td>${a.buyCount}回</td></tr>
        <tr><th>ライフイベントで強制的に売った額</th><td>${man(a.forcedSaleTotal)}</td></tr>
        <tr class="sep"><th>NISAで非課税になった額<br><span class="small">（課税口座なら払っていた税金の目安：利益×${(CONFIG.tax.rate * 100).toFixed(3)}%）</span></th><td>${man(a.taxSaved)}</td></tr>
        <tr><th>手数料（信託報酬）の目安</th><td>${man(a.feeTotal)}</td></tr>
      </table>
      ${forcedLines.length ? `<ul class="forced-list">${forcedLines.join('')}</ul>` : ''}
    </div>
    <div class="card">
      <table class="result-table fund-table">
        <tr><th>ファンド</th><td>評価額</td><td>損益</td></tr>
        ${a.byFund
          .map((b) => {
            const d = fundDef(b.fund);
            const state = b.endedActive ? '' : '<br><span class="small">（売ったまま）</span>';
            return `<tr><th style="color:${d.color}">${escapeHtml(d.short)}${state}</th><td>${man(b.finalValue)}</td><td class="${signClass(b.profit)}">${manSigned(b.profit)}</td></tr>`;
          })
          .join('')}
      </table>
      ${debt > 0 ? `<p class="small minus">お金が足りず、${man(debt)}を借金でしのいだ。</p>` : ''}
    </div>
    <div class="card">
      <canvas id="result-chart"></canvas>
      <div class="legend"><span style="color:#ff5a6e">▼売った</span><span style="color:#ffb347">▼手を離した</span><span style="color:#8fe3c4">▲再開した</span><span style="color:#c99bff">●強制売却</span></div>
    </div>
    <p class="small" style="text-align:center;margin:8px 0 0">シード：${res.seed}（同じシードなら同じ値動き）</p>
    <button class="btn primary" id="r-retry" type="button">もう一度（新しい相場）</button>
    <button class="btn mint" id="r-settings" type="button">設定を変えてもう一度（同じ相場）</button>
    <button class="btn" id="r-share" type="button">結果をシェア</button>
    <button class="btn ghost" id="r-title" type="button">タイトルへ</button>
  `;
  el.scrollTop = 0;
  el.querySelector('#r-hero')!.appendChild(spriteCanvas(sprites, good ? 'victory' : 'sad', 2));
  el.querySelector('#r-retry')!.addEventListener('click', h.onRetry);
  el.querySelector('#r-settings')!.addEventListener('click', h.onChangeSettings);
  el.querySelector('#r-share')!.addEventListener('click', h.onShare);
  el.querySelector('#r-title')!.addEventListener('click', h.onTitle);
  drawResultChart(el.querySelector<HTMLCanvasElement>('#result-chart')!, market, res);
}

/** 20年の値動きと、売買・強制売却のタイミング */
function drawResultChart(canvas: HTMLCanvasElement, market: Market, res: GameResult): void {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const w = 300;
  const h = 110;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const prices = market.prices;
  const logs = prices.map(Math.log);
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const pad = 8;
  const x = (m: number) => pad + ((w - pad * 2) * m) / (prices.length - 1);
  const y = (p: number) => h - pad - ((h - pad * 2) * (Math.log(p) - lo)) / (hi - lo || 1);

  // 暴落シナリオの期間
  for (const s of market.scenarios) {
    ctx.fillStyle = s.isCrash ? 'rgba(255,90,110,0.15)' : 'rgba(255,224,102,0.12)';
    ctx.fillRect(x(s.startMonth), 0, x(s.endMonth) - x(s.startMonth), h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.fillText(s.name, x(s.startMonth) + 2, 10);
  }
  ctx.strokeStyle = '#e8f4ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  prices.forEach((p, m) => (m === 0 ? ctx.moveTo(x(m), y(p)) : ctx.lineTo(x(m), y(p))));
  ctx.stroke();

  const tri = (m: number, p: number, up: boolean, color: string) => {
    const cx = x(m);
    const cy = y(p);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (up) {
      ctx.moveTo(cx, cy + 2);
      ctx.lineTo(cx - 4, cy + 9);
      ctx.lineTo(cx + 4, cy + 9);
    } else {
      ctx.moveTo(cx, cy - 2);
      ctx.lineTo(cx - 4, cy - 9);
      ctx.lineTo(cx + 4, cy - 9);
    }
    ctx.fill();
  };
  for (const t of res.actual.trades) {
    if (t.type === 'buy') tri(t.month, t.price, true, '#8fe3c4');
    else tri(t.month, t.price, false, t.type === 'sell' ? '#ff5a6e' : '#ffb347');
  }
  for (const o of res.actual.eventOutcomes) {
    if (o.forcedSale <= 0) continue;
    ctx.fillStyle = '#c99bff';
    ctx.beginPath();
    ctx.arc(x(o.event.month), y(o.price), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
