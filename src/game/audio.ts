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

export type BgmTrack = 'title' | 'game';

/**
 * BGM。タイトル（メニュー）用とプレイ中用の2曲をループ再生する。結果画面では流さない。
 * 「流したい曲（track）」と「プレイヤーが ON にしているか（enabled）」の両方がそろったときだけ鳴らす。
 * ブラウザの自動再生制限で鳴らせなかったときは、次にユーザーが画面を触ったとき（kick）に鳴らし直す
 */
export class Bgm {
  private readonly els: Partial<Record<BgmTrack, HTMLAudioElement>> = {};
  private track: BgmTrack | null = null;
  private wanted = false;

  constructor(public enabled: boolean) {}

  private audio(track: BgmTrack): HTMLAudioElement {
    let el = this.els[track];
    if (!el) {
      const base = import.meta.env.BASE_URL ?? './';
      el = new Audio(`${base}${CONFIG.audio.files[track]}`);
      el.loop = true;
      el.preload = 'auto';
      el.volume = CONFIG.audio.volume[track];
      this.els[track] = el;
    }
    return el;
  }

  /** その曲を流す。違う曲からの切り替え、または fromStart のときは頭から */
  play(track: BgmTrack, fromStart = false): void {
    const switching = this.track !== track;
    if (switching && this.track) {
      const old = this.els[this.track];
      if (old) {
        old.pause();
        old.currentTime = 0;
      }
    }
    this.track = track;
    this.wanted = true;
    if ((switching || fromStart) && this.els[track]) this.els[track]!.currentTime = 0;
    this.apply();
  }

  /** 一時停止（続きから再開できる） */
  pause(): void {
    this.wanted = false;
    this.apply();
  }

  resume(): void {
    if (!this.track) return;
    this.wanted = true;
    this.apply();
  }

  /** 止める（結果画面など） */
  stop(): void {
    this.wanted = false;
    this.apply();
    if (this.track && this.els[this.track]) this.els[this.track]!.currentTime = 0;
    this.track = null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.apply();
  }

  /** ユーザーが画面を触ったときに呼ぶ。自動再生で止められていたら鳴らし直す */
  kick(): void {
    if (this.wanted && this.enabled && this.track && this.audio(this.track).paused) this.apply();
  }

  get playingTrack(): BgmTrack | null {
    return this.wanted && this.enabled ? this.track : null;
  }

  private apply(): void {
    for (const [t, el] of Object.entries(this.els) as [BgmTrack, HTMLAudioElement][]) {
      if (t !== this.track && !el.paused) el.pause();
    }
    if (!this.track) return;
    if (this.wanted && this.enabled) {
      // 自動再生が拒否された場合は黙って無音のまま（kick で鳴らし直す）
      this.audio(this.track).play().catch(() => {});
    } else {
      const el = this.els[this.track];
      if (el && !el.paused) el.pause();
    }
  }
}
