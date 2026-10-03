// サウンドの差し込み口。今回は無音。
// 後から Web Audio などで鳴らすときは、ここの実装だけを差し替える。

export type SfxName = 'tap' | 'sell' | 'buy' | 'letGo' | 'crash' | 'event' | 'celebrate' | 'monthTick' | 'result';

export interface AudioPlayer {
  play(name: SfxName): void;
}

export const audio: AudioPlayer = {
  play() {
    /* no-op */
  },
};
