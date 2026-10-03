// 称号判定。上から順に判定し、最初に当てはまったものを返す。

import { CONFIG, type Config } from '../config';
import { maxDrawdown, type Market } from './market';
import type { SimSummary } from './portfolio';

export type TitleId = 'steel' | 'bottomGenius' | 'lifeLoser' | 'timingWizard' | 'getOff' | 'normal';

export interface Title {
  id: TitleId;
  name: string;
  description: string;
}

export const TITLES: Record<TitleId, Omit<Title, 'id'>> = {
  steel: { name: '鋼の握力', description: '一度も売らず、手も離さず、生活にも負けなかった。' },
  bottomGenius: { name: '底で売る天才', description: 'いちばん深い暴落の、ほぼ底で売ってしまった。' },
  lifeLoser: { name: '生活に負けた人', description: '暴落ではなく、生活のために売らされた。' },
  timingWizard: { name: 'タイミングの魔術師（自称）', description: '売って、買って、また売った。' },
  getOff: { name: '途中下車', description: '一度降りて、最後まで戻らなかった。' },
  normal: { name: 'ふつうにえらい', description: '迷いながらも、なんとか続けた。' },
};

export function determineTitle(summary: SimSummary, market: Market, cfg: Config = CONFIG): Title {
  const tc = cfg.titles;
  const make = (id: TitleId): Title => ({ id, ...TITLES[id] });
  const sales = summary.trades.filter((t) => t.type === 'sell' || t.type === 'letGo');

  if (sales.length === 0 && summary.forcedSaleTotal === 0) return make('steel');

  const { troughMonth } = maxDrawdown(market.prices);
  if (sales.some((t) => Math.abs(t.month - troughMonth) <= tc.bottomWindowMonths)) return make('bottomGenius');

  if (summary.forcedSaleTotal >= tc.lifeLoserThreshold) return make('lifeLoser');

  if (Math.min(sales.length, summary.buyCount) >= tc.timingWizardCount) return make('timingWizard');

  if (sales.length > 0 && !summary.endedInvested) return make('getOff');

  return make('normal');
}
