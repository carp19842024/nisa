// タイトル画面

import { load } from './storage';
import { escapeHtml, man } from './format';

export function renderTitle(
  el: HTMLElement,
  handlers: { onStart(): void; onDisclaimer(): void; bgmOn(): boolean; onSetBgm(on: boolean): void },
): void {
  const hs = load().highScore;
  el.className = 'screen clear';
  el.innerHTML = `
    <h1>つみたて！</h1>
    <p class="subtitle">〜 暴落チキンレース 〜</p>
    <div class="spacer"></div>
    <div class="spacer"></div>
    <p class="highscore">${
      hs
        ? `ハイスコア（資産の合計）：<b>${man(hs.finalValue)}</b><br><span class="small">称号「${escapeHtml(hs.title)}」</span>`
        : 'ハイスコア：まだありません'
    }</p>
    <button class="btn primary" id="title-start" type="button">はじめる</button>
    <button class="btn ghost" id="title-disclaimer" type="button">注意事項</button>
    <div class="bgm-switch" role="group" aria-label="BGM">
      <span class="bgm-switch-label">BGM</span>
      <button type="button" class="bgm-opt" data-on="1">ON</button>
      <button type="button" class="bgm-opt" data-on="0">OFF</button>
    </div>
  `;
  // 選んでいるほうを塗りつぶし＋✓で示す
  const opts = Array.from(el.querySelectorAll<HTMLButtonElement>('.bgm-opt'));
  const refresh = () => {
    const on = handlers.bgmOn();
    for (const b of opts) {
      const selected = (b.dataset.on === '1') === on;
      b.classList.toggle('selected', selected);
      b.setAttribute('aria-pressed', String(selected));
      b.textContent = `${selected ? '✓ ' : ''}${b.dataset.on === '1' ? 'ON' : 'OFF'}`;
    }
  };
  for (const b of opts) {
    b.addEventListener('click', () => {
      handlers.onSetBgm(b.dataset.on === '1');
      refresh();
    });
  }
  refresh();
  el.querySelector('#title-start')!.addEventListener('click', handlers.onStart);
  el.querySelector('#title-disclaimer')!.addEventListener('click', handlers.onDisclaimer);
}
