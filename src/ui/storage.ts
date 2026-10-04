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
  /** BGM を OFF にしている */
  bgmOff?: boolean;
}

/**
 * localStorage が使えない環境（埋め込み表示・プライベートモードなど）でも、
 * 開いている間はハイスコアなどが残るよう、メモリにも同じ内容を持っておく
 */
let memory: SaveData = {};

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (raw) {
      const data = JSON.parse(raw) as unknown;
      if (data && typeof data === 'object') memory = data as SaveData;
    }
  } catch {
    /* 読めなければメモリの内容を使う */
  }
  return { ...memory };
}

export function save(data: SaveData): void {
  memory = { ...data };
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
  } catch {
    /* 保存できなくてもゲームは続ける（この画面を開いている間はメモリに残る） */
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

export function setBgmOff(off: boolean): void {
  save({ ...load(), bgmOff: off });
}
