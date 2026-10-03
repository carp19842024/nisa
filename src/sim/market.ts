// 値動きの生成。幾何ブラウン運動に暴落シナリオを重ねる。
// 描画には一切依存しない純粋なロジック。

import { CONFIG, type Config, type FundId, type ScenarioConfig, type ScenarioId } from '../config';
import { createRng, deriveSeed, type Rng } from './rng';

export interface ScenarioInstance {
  id: ScenarioId;
  name: string;
  isCrash: boolean;
  /** シナリオ開始月 */
  startMonth: number;
  /** 下落が終わる（底をつける）月 */
  bottomMonth: number;
  /** シナリオ終了月（回復完了・停滞終了） */
  endMonth: number;
  /** [開始からの月数, 倍率] の折れ線。倍率は開始時点の水準に対する比 */
  keypoints: [number, number][];
}

/** テーマ型ファンド独自の暴落（ブーム終了） */
export interface FundBustInstance {
  fund: FundId;
  name: string;
  banner: string;
  startMonth: number;
  bottomMonth: number;
  endMonth: number;
  keypoints: [number, number][];
}

export interface Market {
  seed: number;
  /** 市場全体の指数（月初）。長さ months + 1（index 0 = 開始時、index months = 最終）。暴落の判定や称号に使う */
  prices: number[];
  /** ファンドごとの基準価額（月初）。長さ months + 1 */
  funds: Partial<Record<FundId, number[]>>;
  scenarios: ScenarioInstance[];
  fundBusts: FundBustInstance[];
}

/** ファンドの基準価額の列。無ければエラー */
export function fundPrices(market: Market, fund: FundId): number[] {
  const p = market.funds[fund];
  if (!p) throw new Error(`ファンド ${fund} の値動きがありません`);
  return p;
}

function buildScenario(id: ScenarioId, rng: Rng, cfg: Config): Omit<ScenarioInstance, 'startMonth' | 'bottomMonth' | 'endMonth'> & { length: number; decline: number } {
  const sc: ScenarioConfig = cfg.scenarios[id];
  const decline = rng.int(sc.declineMonths[0], sc.declineMonths[1]);
  const recovery = rng.int(sc.recoveryMonths[0], sc.recoveryMonths[1]);
  let keypoints: [number, number][];
  if (id === 'oufuku') {
    const a = Math.max(1, Math.round(decline / 3));
    const b = Math.max(a + 1, Math.round((decline * 2) / 3));
    keypoints = [
      [0, 1],
      [a, 1 - (sc.firstDip ?? sc.depth * 0.7)],
      [b, 1 - (sc.reboundTo ?? sc.depth * 0.3)],
      [decline, 1 - sc.depth],
      [decline + recovery, 1],
    ];
  } else if (sc.depth === 0) {
    keypoints = [
      [0, 1],
      [recovery, 1],
    ];
  } else {
    keypoints = [
      [0, 1],
      [decline, 1 - sc.depth],
      [decline + recovery, 1],
    ];
  }
  return { id, name: sc.name, isCrash: sc.isCrash, keypoints, length: decline + recovery, decline };
}

/** シナリオの重ね合わせ倍率（開始前・終了後は 1） */
export function overlayAt(sc: ScenarioInstance, month: number): number {
  const local = month - sc.startMonth;
  const kp = sc.keypoints;
  if (local <= 0) return kp[0][1];
  if (local >= kp[kp.length - 1][0]) return kp[kp.length - 1][1];
  for (let i = 1; i < kp.length; i++) {
    const [m1, v1] = kp[i];
    const [m0, v0] = kp[i - 1];
    if (local <= m1) {
      const f = (local - m0) / (m1 - m0);
      // 対数空間で補間する（％で見て等速に動くように）
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * f);
    }
  }
  return 1;
}

/** 20年のうちに差し込むシナリオを決めて配置する */
export function placeScenarios(rng: Rng, cfg: Config = CONFIG): ScenarioInstance[] {
  const mc = cfg.market;
  const all = Object.keys(cfg.scenarios) as ScenarioId[];
  const others = rng.shuffle(all.filter((id) => id !== mc.mandatoryScenario));
  let count = rng.int(mc.scenarioCount.min, mc.scenarioCount.max);

  for (;;) {
    const ids = rng.shuffle([mc.mandatoryScenario, ...others.slice(0, count - 1)]);
    const built = ids.map((id) => buildScenario(id, rng, cfg));
    const total = built.reduce((s, b) => s + b.length, 0);
    const free = cfg.months - mc.earliestStartMonth - total - mc.minGapMonths * (built.length - 1);
    if (free < 0) {
      if (count <= 1) throw new Error('シナリオが期間に収まりません。config を見直してください');
      count--;
      continue;
    }
    // 余った月を (n+1) 個の隙間にランダムに配る
    const weights = Array.from({ length: built.length + 1 }, () => rng.next() + 0.05);
    const wsum = weights.reduce((s, w) => s + w, 0);
    const gaps = weights.map((w) => Math.floor((free * w) / wsum));

    const result: ScenarioInstance[] = [];
    let cursor = mc.earliestStartMonth;
    built.forEach((b, i) => {
      cursor += gaps[i] + (i > 0 ? mc.minGapMonths : 0);
      result.push({
        id: b.id,
        name: b.name,
        isCrash: b.isCrash,
        keypoints: b.keypoints,
        startMonth: cursor,
        bottomMonth: cursor + b.decline,
        endMonth: cursor + b.length,
      });
      cursor += b.length;
    });
    return result;
  }
}

/** シード から値動きを生成する。同じシードなら必ず同じ結果になる */
export function generateMarket(seed: number, cfg: Config = CONFIG): Market {
  const rng = createRng(deriveSeed(seed, 1));
  const scenarios = placeScenarios(rng, cfg);
  const mc = cfg.market;
  const dt = 1 / 12;
  const sigma = mc.annualVolatility;
  const drift = Math.log(1 + mc.annualReturn) * dt;
  const vol = sigma * Math.sqrt(dt);

  const findScenario = (m: number) => scenarios.find((s) => m >= s.startMonth && m < s.endMonth);

  // 市場全体の指数。月ごとのふだんの値動き（shock）と暴落の重ね合わせ（overlayLog）を記録しておき、
  // 各ファンドはそれに感応度をかけて作る
  const prices: number[] = [];
  const shocks: number[] = [];
  const driftScales: number[] = [];
  const overlayLogs: number[] = [];
  let logBase = 0;
  for (let m = 0; m <= cfg.months; m++) {
    let overlay = 1;
    for (const s of scenarios) overlay *= overlayAt(s, m);
    overlayLogs.push(Math.log(overlay));
    prices.push(mc.initialPrice * Math.exp(logBase) * overlay);
    if (m === cfg.months) break;
    const z = rng.normal();
    const sc = findScenario(m);
    const sCfg = sc ? cfg.scenarios[sc.id] : null;
    const dScale = sCfg ? sCfg.driftScale : 1;
    const vScale = sCfg ? sCfg.volScale : 1;
    shocks.push(vol * vScale * z);
    driftScales.push(dScale);
    logBase += drift * dScale + vol * vScale * z;
  }

  // ファンド独自の値動きとブーム終了は、市場とは別の乱数列（既存シードの市場の値動きを変えないため）
  const fundRng = createRng(deriveSeed(seed, 3));
  const fundBusts = placeFundBusts(createRng(deriveSeed(seed, 4)), cfg);
  const funds: Partial<Record<FundId, number[]>> = {};
  const logs = cfg.funds.map(() => 0);
  const series = cfg.funds.map(() => [] as number[]);
  for (let m = 0; m <= cfg.months; m++) {
    cfg.funds.forEach((f, i) => {
      let bust = 1;
      for (const b of fundBusts) if (b.fund === f.id) bust *= keypointsAt(b.keypoints, m - b.startMonth);
      series[i].push(mc.initialPrice * Math.exp(logs[i] + f.crashBeta * overlayLogs[m]) * bust);
    });
    if (m === cfg.months) break;
    cfg.funds.forEach((f, i) => {
      const idio = f.idioVol * Math.sqrt(dt) * fundRng.normal();
      logs[i] += Math.log(1 + f.annualReturn) * dt * driftScales[m] + f.beta * shocks[m] + idio;
    });
  }
  cfg.funds.forEach((f, i) => (funds[f.id] = series[i]));

  return { seed, prices, funds, scenarios, fundBusts };
}

function keypointsAt(keypoints: [number, number][], local: number): number {
  return overlayAt({ keypoints, startMonth: 0 } as ScenarioInstance, local);
}

/** テーマ型ファンドの「ブーム終了」を決める */
function placeFundBusts(rng: Rng, cfg: Config): FundBustInstance[] {
  const result: FundBustInstance[] = [];
  for (const b of cfg.fundBusts) {
    const roll = rng.next();
    const decline = rng.int(b.declineMonths[0], b.declineMonths[1]);
    const stagnant = rng.int(b.stagnantMonths[0], b.stagnantMonths[1]);
    const latest = cfg.months - decline - 12;
    const start = rng.int(b.earliestMonth, Math.max(b.earliestMonth, latest));
    if (roll >= b.prob) continue;
    const fund = cfg.funds.find((f) => f.id === b.fund);
    const growth = fund ? Math.log(1 + fund.annualReturn) / 12 : 0;
    const bottom = 1 - b.depth;
    result.push({
      fund: b.fund,
      name: b.name,
      banner: b.banner,
      startMonth: start,
      bottomMonth: start + decline,
      endMonth: start + decline + stagnant,
      // 底のあとはファンド本来の成長を打ち消して停滞させる（戻らないまま）
      keypoints: [
        [0, 1],
        [decline, bottom],
        [decline + stagnant, bottom * Math.exp(-growth * stagnant)],
      ],
    });
  }
  return result;
}

/** 連続時間 t（月）の価格。月と月の間は直線で補間する */
export function priceAt(prices: readonly number[], t: number): number {
  if (t <= 0) return prices[0];
  const last = prices.length - 1;
  if (t >= last) return prices[last];
  const i = Math.floor(t);
  const f = t - i;
  return prices[i] + (prices[i + 1] - prices[i]) * f;
}

export interface DrawdownPoint {
  /** 下落率が最大になった月（底） */
  troughMonth: number;
  /** そのときの高値の月 */
  peakMonth: number;
  /** 最大ドローダウン（0.4 = −40%） */
  maxDrawdown: number;
}

/** 最も深い下落（最大ドローダウン）を求める */
export function maxDrawdown(prices: readonly number[]): DrawdownPoint {
  let peak = prices[0];
  let peakMonth = 0;
  let best: DrawdownPoint = { troughMonth: 0, peakMonth: 0, maxDrawdown: 0 };
  for (let m = 0; m < prices.length; m++) {
    if (prices[m] > peak) {
      peak = prices[m];
      peakMonth = m;
    }
    const dd = 1 - prices[m] / peak;
    if (dd > best.maxDrawdown) best = { troughMonth: m, peakMonth, maxDrawdown: dd };
  }
  return best;
}

/** その月が「暴落中」（下落開始〜回復の前半）か */
export function isCrashMonth(scenarios: readonly ScenarioInstance[], month: number): boolean {
  return scenarios.some((s) => {
    if (!s.isCrash) return false;
    const recoveryHalf = Math.floor((s.endMonth - s.bottomMonth) / 2);
    return month >= s.startMonth && month <= s.bottomMonth + recoveryHalf;
  });
}
