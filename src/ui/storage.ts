// localStorage：ハイスコア（と注意事項を読んだかどうか）だけを保存する。
// プライベートモード等で使えなくても動くよう、読み書きはすべて try/catch で囲む。

import { CONFIG } from '../config';

export interface SaveData {
  highScore?: {
    finalValue: number;
    profit: number;
    title: string;
    seed: number;
  };
  /** 注意事項を一度読んだら、以降はスキップできる */
  seenDisclaimer?: boolean;
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return {};
    const data = JSON.parse(raw) as unknown;
    return data && typeof data === 'object' ? (data as SaveData) : {};
  } catch {
    return {};
  }
}

export function save(data: SaveData): void {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
  } catch {
    /* 保存できなくてもゲームは続ける */
  }
}

/** ハイスコア（最終評価額）を更新したら true */
export function submitScore(score: NonNullable<SaveData['highScore']>): boolean {
  const data = load();
  if (data.highScore && data.highScore.finalValue >= score.finalValue) return false;
  save({ ...data, highScore: score });
  return true;
}

export function markDisclaimerSeen(): void {
  save({ ...load(), seenDisclaimer: true });
}
