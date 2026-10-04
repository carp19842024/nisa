// 注意事項画面（初回のみ必須）

export function renderDisclaimer(el: HTMLElement, opts: { firstTime: boolean; onOk(): void; onBack?(): void }): void {
  el.className = 'screen';
  el.innerHTML = `
    <h2>注意事項</h2>
    <div class="card">
      <ul class="notice-list">
        <li>このゲームは<b>架空のシミュレーション</b>で、投資助言ではありません。</li>
        <li>登場するファンドや値動きは<b>架空のもの</b>で、将来の運用成果を示すものではありません。</li>
        <li>NISA制度の内容は<b>2026年時点の情報</b>をもとに簡略化しています。</li>
      </ul>
    </div>
    <div class="card small">
      <p>遊び方：平常時は見ているだけでOK。暴落が来ると「全部売った」「まだ下がるってよ」などの<b>誘惑</b>が主人公に飛んできます。当たると握力が減るので、<b>タップやスワイプで払いのけよう</b>。緑の言葉は役に立つので、払わずに届かせると握力が回復します。握力が尽きると手を離して全部売ってしまいます。</p>
      <p>画面下のファンドのボタンを1秒長押しすると、そのファンドを全部売ります（代金は生活防衛資金へ。そのファンドの積立も止まります）。</p><p>ボタンを短く押すと、そのファンドの毎月の積立額を変えたり、生活防衛資金からまとめ買いしたりできます。最初に選ばなかったファンドも途中から始められます。NISAで買えるのは年間360万円・生涯1,800万円までです。</p>
    </div>
    <div class="spacer"></div>
    <button class="btn primary" id="disc-ok" type="button">${opts.firstTime ? '理解しました' : 'OK'}</button>
    ${opts.onBack ? '<button class="btn ghost" id="disc-back" type="button">戻る</button>' : ''}
  `;
  el.querySelector('#disc-ok')!.addEventListener('click', opts.onOk);
  if (opts.onBack) el.querySelector('#disc-back')!.addEventListener('click', opts.onBack);
}
