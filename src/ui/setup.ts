// 積立設定画面：月5万円を、ファンドごとの NISA 積立と生活防衛資金に1万円単位で振り分ける

import { CONFIG, type FundId } from '../config';
import type { SpriteName, SpriteSet } from '../game/sprites';
import type { Allocation } from '../sim/portfolio';
import { spriteCanvas } from './dom';
import { escapeHtml, man } from './format';

function advice(units: Record<FundId, number>, save: number): { sprite: SpriteName; text: string } {
  const invest = Object.values(units).reduce((s, v) => s + v, 0);
  const funds = Object.values(units).filter((v) => v > 0).length;
  if (save === 0) return { sprite: 'shock', text: '貯金ゼロ…。急な出費があったら、ファンドを売るしかないかも。' };
  if (units.rocket >= 3) return { sprite: 'shock', text: 'ロケット多め。当たれば大きいけど、暴落で握力がもつか…。' };
  if (units.gold + units.mattari >= 3 && units.gold + units.mattari === invest)
    return { sprite: 'run', text: '守り重視。暴落には強いけど、増え方はおだやか。' };
  if (funds >= 3) return { sprite: 'run_happy', text: '分散型。暴落のときも、全部が一緒に下がるわけじゃない。' };
  if (save >= 3) return { sprite: 'run', text: '慎重派。安心だけど、増えるお金は少なめ。' };
  if (save === 2) return { sprite: 'run_happy', text: 'バランス型。暴落と出費が重なっても、少しは耐えられそう。' };
  return { sprite: 'run', text: 'ちょっと攻め気味。防衛資金が尽きたら、相場に関係なく売ることに。' };
}

export function renderSetup(
  el: HTMLElement,
  sprites: SpriteSet,
  opts: { initial: Allocation; seedLabel: string | null; onStart(a: Allocation): void; onBack(): void },
): void {
  const unit = CONFIG.money.allocationUnit;
  const total = CONFIG.money.monthlyBudget / unit;
  const minInvest = CONFIG.money.minInvest / unit;
  const units = Object.fromEntries(
    CONFIG.funds.map((f) => [f.id, Math.round((opts.initial.invest[f.id] ?? 0) / unit)]),
  ) as Record<FundId, number>;
  const investUnits = () => Object.values(units).reduce((s, v) => s + v, 0);

  const fundRows = CONFIG.funds
    .map(
      (f) => `
      <div class="fund-row" style="--fund:${f.color}">
        <div class="fund-info">
          <b>${escapeHtml(f.name)}</b>
          <span class="small">${escapeHtml(f.desc)}</span>
          <span class="small">ブレ ${'★'.repeat(f.risk)}${'☆'.repeat(5 - f.risk)}／手数料 年${(f.fee * 100).toFixed(1)}%</span>
        </div>
        <div class="stepper-mini">
          <button type="button" data-f="${f.id}" data-d="-1" aria-label="${escapeHtml(f.short)}を減らす">−</button>
          <b id="s-${f.id}"></b>
          <button type="button" data-f="${f.id}" data-d="1" aria-label="${escapeHtml(f.short)}を増やす">＋</button>
        </div>
      </div>`,
    )
    .join('');
  const ineligible = CONFIG.ineligibleFunds
    .map(
      (f) => `
      <div class="fund-row ineligible">
        <div class="fund-info"><b>${escapeHtml(f.name)}</b><span class="small">${escapeHtml(f.reason)}</span></div>
        <div class="stepper-mini"><span class="small">買えません</span></div>
      </div>`,
    )
    .join('');

  el.className = 'screen';
  el.innerHTML = `
    <h2>積立設定</h2>
    <div class="card">
      <p>毎月使える余裕資金は <b>${man(CONFIG.money.monthlyBudget, 0)}</b>。どう振り分ける？</p>
      ${fundRows}
      ${ineligible}
      <div class="stepper"><span>生活防衛資金（貯金）</span><b id="s-sav"></b></div>
      <div class="alloc-bar" id="s-bar"></div>
    </div>
    <div class="card advice"><span id="s-face"></span><p id="s-advice"></p></div>
    <div class="card small">
      <p>ファンドはすべて架空です。期間は20年（240か月）、生活防衛資金の初期額は${man(CONFIG.money.initialEmergencyFund, 0)}。</p>
      <p>ゲーム中はファンドごとに売れます（売った分は貯金へ）。出費は生活防衛資金から払い、足りない分はファンドを売って払います。</p>
      ${opts.seedLabel ? `<p>シード：${opts.seedLabel}</p>` : ''}
    </div>
    <button class="btn primary" id="s-start" type="button">20年の積立をはじめる</button>
    <button class="btn ghost" id="s-back" type="button">タイトルへ</button>
  `;

  const savEl = el.querySelector<HTMLElement>('#s-sav')!;
  const bar = el.querySelector<HTMLElement>('#s-bar')!;
  const face = el.querySelector<HTMLElement>('#s-face')!;
  const adviceEl = el.querySelector<HTMLElement>('#s-advice')!;
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.stepper-mini button'));

  const update = () => {
    const inv = investUnits();
    const save = total - inv;
    for (const f of CONFIG.funds) el.querySelector<HTMLElement>(`#s-${f.id}`)!.textContent = man(units[f.id] * unit, 0);
    savEl.textContent = man(save * unit, 0);
    const cells: string[] = [];
    for (const f of CONFIG.funds) {
      for (let i = 0; i < units[f.id]; i++) cells.push(`<span style="background:${f.color}">${escapeHtml(f.short)}</span>`);
    }
    for (let i = 0; i < save; i++) cells.push('<span class="sav">貯金</span>');
    bar.innerHTML = cells.join('');
    const a = advice(units, save);
    face.replaceChildren(spriteCanvas(sprites, a.sprite, 1));
    adviceEl.textContent = a.text;
    for (const b of buttons) {
      const f = b.dataset.f as FundId;
      const d = Number(b.dataset.d);
      b.disabled = d > 0 ? inv >= total : units[f] <= 0 || inv <= minInvest;
    }
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const f = b.dataset.f as FundId;
      const d = Number(b.dataset.d);
      const inv = investUnits();
      if (d > 0 && inv < total) units[f]++;
      if (d < 0 && units[f] > 0 && inv > minInvest) units[f]--;
      update();
    });
  }
  el.querySelector('#s-start')!.addEventListener('click', () => {
    const invest: Allocation['invest'] = {};
    for (const f of CONFIG.funds) if (units[f.id] > 0) invest[f.id] = units[f.id] * unit;
    opts.onStart({ invest, savePerMonth: (total - investUnits()) * unit });
  });
  el.querySelector('#s-back')!.addEventListener('click', opts.onBack);
  update();
}
