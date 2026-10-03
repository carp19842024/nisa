// タイトル画面

import { load } from './storage';
import { escapeHtml, man } from './format';

export function renderTitle(el: HTMLElement, handlers: { onStart(): void; onDisclaimer(): void }): void {
  const hs = load().highScore;
  el.className = 'screen clear';
  el.innerHTML = `
    <h1>しがみつけ！</h1>
    <p class="subtitle">〜 暴落チキンレース 〜</p>
    <div class="spacer"></div>
    <div class="spacer"></div>
    <p class="highscore">${
      hs
        ? `ハイスコア：<b>${man(hs.finalValue)}</b><br><span class="small">称号「${escapeHtml(hs.title)}」</span>`
        : 'ハイスコア：まだありません'
    }</p>
    <button class="btn primary" id="title-start" type="button">はじめる</button>
    <button class="btn ghost" id="title-disclaimer" type="button">注意事項</button>
  `;
  el.querySelector('#title-start')!.addEventListener('click', handlers.onStart);
  el.querySelector('#title-disclaimer')!.addEventListener('click', handlers.onDisclaimer);
}
