// サウンド。BGM はプレイ中だけ流す（タイトル・設定・結果では流さない）。
// 効果音は差し込み口だけ用意してあり、今は無音。

import { CONFIG } from '../config';

export type SfxName = 'tap' | 'sell' | 'buy' | 'letGo' | 'crash' | 'event' | 'celebrate' | 'monthTick' | 'result';

export interface AudioPlayer {
  play(name: SfxName): void;
}

export const audio: AudioPlayer = {
  play() {
    /* no-op */
  },
};

/**
 * プレイ中の BGM。ループ再生。
 * 「流したい状態か（wanted）」と「プレイヤーが ON にしているか（enabled）」の両方が true のときだけ鳴らす。
 * ブラウザの自動再生制限があるので、start() はボタンのクリックなど、ユーザー操作の中から呼ぶ
 */
export class Bgm {
  private el: HTMLAudioElement | null = null;
  private wanted = false;

  constructor(public enabled: boolean) {}

  private get audioEl(): HTMLAudioElement {
    if (!this.el) {
      const base = import.meta.env.BASE_URL ?? './';
      this.el = new Audio(`${base}${CONFIG.audio.bgmFile}`);
      this.el.loop = true;
      this.el.preload = 'auto';
      this.el.volume = CONFIG.audio.bgmVolume;
    }
    return this.el;
  }

  /** 頭から流す（本編の開始） */
  start(): void {
    this.wanted = true;
    if (this.enabled) this.audioEl.currentTime = 0;
    else if (this.el) this.el.currentTime = 0;
    this.apply();
  }

  /** 一時停止（続きから再開できる） */
  pause(): void {
    this.wanted = false;
    this.apply();
  }

  resume(): void {
    this.wanted = true;
    this.apply();
  }

  /** 止める（本編の終了・タイトルへ戻る） */
  stop(): void {
    this.wanted = false;
    this.apply();
    if (this.el) this.el.currentTime = 0;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.apply();
  }

  private apply(): void {
    if (this.wanted && this.enabled) {
      // 自動再生が拒否された場合は黙って無音のまま（次の操作で再開される）
      this.audioEl.play().catch(() => {});
    } else if (this.el && !this.el.paused) {
      this.el.pause();
    }
  }
}
