// 称号判定。上から順に判定し、最初に当てはまったものを返す。

import { CONFIG, type Config } from '../config';
import { maxDrawdown, type Market } from './market';
import { allocatedFunds, totalInvest, type Allocation, type SimSummary } from './portfolio';

export type TitleId =
  | 'diversified'
  | 'steel'
  | 'bottomGenius'
  | 'lifeLoser'
  | 'rocketDreamer'
  | 'timingWizard'
  | 'shakenOff'
  | 'getOff'
  | 'goldBug'
  | 'normal';

export interface Title {
  id: TitleId;
  name: string;
  description: string;
}

export const TITLES: Record<TitleId, Omit<Title, 'id'>> = {
  diversified: { name: '分散の達人', description: '3本以上に分けて、一度も売らずに持ち続けた。' },
  steel: { name: '鋼の握力', description: '一度も売らず、手も離さず、生活にも負けなかった。' },
  bottomGenius: { name: '底で売る天才', description: 'いちばん深い暴落の、ほぼ底で売ってしまった。' },
  lifeLoser: { name: '生活に負けた人', description: '暴落ではなく、生活のために売らされた。' },
  rocketDreamer: { name: 'ロケットに夢を見た人', description: 'テーマ型に賭けて、途中で手を放した。' },
  timingWizard: { name: 'タイミングの魔術師（自称）', description: '売って、買って、また売った。' },
  shakenOff: { name: '振り落とされた人', description: '握力が尽きて手を離し、そのまま戻れなかった。' },
  getOff: { name: '途中下車', description: '自分で降りて、最後まで戻らなかった。' },
  goldBug: { name: '金の亡者', description: '金に守られたけど、株の上昇は取り逃がした。' },
  normal: { name: 'ふつうにえらい', description: '迷いながらも、なんとか続けた。' },
};

export interface TitleContext {
  allocation: Allocation;
  /** 同じ積立額を「ぜんぶ入りファンド」だけで持ち続けた場合の資産の合計 */
  zenbuOnlyTotal: number;
}

export function determineTitle(summary: SimSummary, market: Market, ctx: TitleContext, cfg: Config = CONFIG): Title {
  const tc = cfg.titles;
  const make = (id: TitleId): Title => ({ id, ...TITLES[id] });
  const sales = summary.trades.filter((t) => t.type === 'sell' || t.type === 'letGo');
  const total = totalInvest(ctx.allocation);
  const share = (f: 'rocket' | 'gold') => (total > 0 ? (ctx.allocation.invest[f] ?? 0) / total : 0);

  if (sales.length === 0 && summary.forcedSaleTotal === 0) {
    return make(allocatedFunds(ctx.allocation, cfg).length >= tc.diversifiedFunds ? 'diversified' : 'steel');
  }

  const { troughMonth } = maxDrawdown(market.prices);
  if (sales.some((t) => Math.abs(t.month - troughMonth) <= tc.bottomWindowMonths)) return make('bottomGenius');

  if (summary.forcedSaleTotal >= tc.lifeLoserThreshold) return make('lifeLoser');

  if (share('rocket') >= tc.heavyShare && sales.some((t) => t.fund === 'rocket')) return make('rocketDreamer');

  // 売却（握力切れ含む）と買い直しの回数。1回の握力切れは1回と数える
  const saleActions = summary.sellCount + summary.letGoCount;
  if (Math.min(saleActions, summary.buyCount) >= tc.timingWizardCount) return make('timingWizard');

  // 最後に1本も積立していない（全部降りたまま）。最後に降りたのが握力切れなら「振り落とされた」
  const noneActive = summary.byFund.every((b) => !b.endedActive);
  if (sales.length > 0 && noneActive) {
    return make(sales[sales.length - 1].type === 'letGo' ? 'shakenOff' : 'getOff');
  }

  if (share('gold') >= tc.heavyShare && summary.totalAssets < ctx.zenbuOnlyTotal) return make('goldBug');

  return make('normal');
}
