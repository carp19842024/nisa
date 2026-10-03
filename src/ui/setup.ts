// 積立設定画面：月5万円を「NISA積立」と「生活防衛資金」に1万円単位で振り分ける

import { CONFIG } from '../config';
import type { SpriteName, SpriteSet } from '../game/sprites';
import type { Allocation } from '../sim/portfolio';
import { spriteCanvas } from './dom';
import { man } from './format';

const ADVICE: Record<number, { sprite: SpriteName; text: string }> = {
  5: { sprite: 'shock', text: '貯金ゼロ…。急な出費があったら、ファンドを売るしかないかも。' },
  4: { sprite: 'run', text: 'ちょっと攻め気味。防衛資金が尽きたら、相場に関係なく売ることに。' },
  3: { sprite: 'run_happy', text: 'バランス型。暴落と出費が重なっても、少しは耐えられそう。' },
  2: { sprite: 'run', text: '慎重派。安心だけど、増えるお金は少なめ。' },
  1: { sprite: 'run', text: 'ほぼ貯金。ドキドキは少ないけど、それでいいの…？' },
};

export function renderSetup(
  el: HTMLElement,
  sprites: SpriteSet,
  opts: { initial: Allocation; seedLabel: string | null; onStart(a: Allocation): void; onBack(): void },
): void {
  const unit = CONFIG.money.allocationUnit;
  const total = CONFIG.money.monthlyBudget / unit;
  const min = CONFIG.money.minInvest / unit;
  let invest = Math.round(opts.initial.investPerMonth / unit);

  el.className = 'screen';
  el.innerHTML = `
    <h2>積立設定</h2>
    <div class="card">
      <p>毎月使える余裕資金は <b>${man(CONFIG.money.monthlyBudget, 0)}</b>。<br>どう振り分ける？</p>
      <div class="stepper"><span>NISA積立</span><span><button type="button" data-d="-1">−</button><b id="s-inv"></b><button type="button" data-d="1">＋</button></span></div>
      <div class="stepper"><span>生活防衛資金</span><b id="s-sav"></b></div>
      <div class="alloc-bar" id="s-bar"></div>
    </div>
    <div class="card advice"><span id="s-face"></span><p id="s-advice"></p></div>
    <div class="card small">
      <p>積立先：架空の「ぜんぶ入りファンド」1本</p>
      <p>期間：20年（240か月）／生活防衛資金の初期額：${man(CONFIG.money.initialEmergencyFund, 0)}</p>
      <p>ライフイベントの出費は、まず生活防衛資金から。足りない分はファンドを売って払います。</p>
      ${opts.seedLabel ? `<p>シード：${opts.seedLabel}</p>` : ''}
    </div>
    <div class="spacer"></div>
    <button class="btn primary" id="s-start" type="button">20年の積立をはじめる</button>
    <button class="btn ghost" id="s-back" type="button">タイトルへ</button>
  `;

  const invEl = el.querySelector<HTMLElement>('#s-inv')!;
  const savEl = el.querySelector<HTMLElement>('#s-sav')!;
  const bar = el.querySelector<HTMLElement>('#s-bar')!;
  const face = el.querySelector<HTMLElement>('#s-face')!;
  const advice = el.querySelector<HTMLElement>('#s-advice')!;
  const [minus, plus] = Array.from(el.querySelectorAll<HTMLButtonElement>('.stepper button'));

  const update = () => {
    invEl.textContent = man(invest * unit, 0);
    savEl.textContent = man((total - invest) * unit, 0);
    bar.innerHTML = Array.from({ length: total }, (_, i) =>
      i < invest ? '<span class="inv">積立</span>' : '<span class="sav">貯金</span>',
    ).join('');
    const a = ADVICE[invest] ?? ADVICE[4];
    face.replaceChildren(spriteCanvas(sprites, a.sprite, 1));
    advice.textContent = a.text;
    minus.disabled = invest <= min;
    plus.disabled = invest >= total;
  };
  minus.addEventListener('click', () => {
    invest = Math.max(min, invest - 1);
    update();
  });
  plus.addEventListener('click', () => {
    invest = Math.min(total, invest + 1);
    update();
  });
  el.querySelector('#s-start')!.addEventListener('click', () =>
    opts.onStart({ investPerMonth: invest * unit, savePerMonth: (total - invest) * unit }),
  );
  el.querySelector('#s-back')!.addEventListener('click', opts.onBack);
  update();
}
