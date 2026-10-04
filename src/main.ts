// 起動と画面遷移：タイトル → 注意事項 → 積立設定 → 本編 → 結果

import '@fontsource/dotgothic16/400.css';
import './styles.css';
import { CONFIG } from './config';
import { Bgm } from './game/audio';
import { Game } from './game/loop';
import { Renderer, VIEW_H, VIEW_W } from './game/renderer';
import { loadSprites, placeholderSprites, type SpriteSet } from './game/sprites';
import { totalInvest, type Allocation } from './sim/portfolio';
import { evaluateGame, type GameResult } from './sim/result';
import { parseSeed, randomSeed } from './sim/rng';
import { $, show } from './ui/dom';
import { renderDisclaimer } from './ui/disclaimer';
import { man, manSigned } from './ui/format';
import { setupHoldButton } from './ui/hold';
import { Hud } from './ui/hud';
import { renderResult } from './ui/result';
import { renderSetup } from './ui/setup';
import { load, markDisclaimerSeen, setBgmOff, submitScore } from './ui/storage';
import { renderTitle } from './ui/title';

type Screen = 'title' | 'disclaimer' | 'setup' | 'game' | 'result';

const stage = $('stage');
const stageWrap = $('stage-wrap');
const canvas = $('game') as HTMLCanvasElement;
const screens: Record<Exclude<Screen, 'game'>, HTMLElement> = {
  title: $('screen-title'),
  disclaimer: $('screen-disclaimer'),
  setup: $('screen-setup'),
  result: $('screen-result'),
};
const pauseOverlay = $('pause-overlay');

let sprites: SpriteSet = placeholderSprites();
const renderer = new Renderer(canvas, sprites);
const hud = new Hud(sprites);

/** URL の ?seed=123 で値動きを固定できる（デバッグ用） */
const urlSeed = parseSeed(new URLSearchParams(location.search).get('seed'));

let screen: Screen = 'title';
let game: Game | null = null;
let allocation: Allocation = {
  invest: { ...CONFIG.money.defaultInvest },
  savePerMonth: CONFIG.money.monthlyBudget - totalInvest({ invest: CONFIG.money.defaultInvest, savePerMonth: 0 }),
};
const bgm = new Bgm(load().bgmOff !== true);

function toggleBgm(): void {
  bgm.setEnabled(!bgm.enabled);
  setBgmOff(!bgm.enabled);
  updateBgmButtons();
}

function updateBgmButtons(): void {
  const hudBtn = $('bgm-btn');
  hudBtn.classList.toggle('off', !bgm.enabled);
  hudBtn.setAttribute('aria-pressed', String(bgm.enabled));
  $('pause-bgm-btn').textContent = `BGM：${bgm.enabled ? 'ON' : 'OFF'}`;
}

/** 「設定を変えてもう一度」のときは同じ相場（シード）で遊ぶ */
let setupSeed: number | null = null;
let lastResult: GameResult | null = null;

// ---------------------------------------------------------------------------
// 画面サイズ：論理解像度 360×640 を、なるべく整数倍で拡大する

function fitStage(): void {
  const vv = window.visualViewport;
  const availW = vv ? vv.width : window.innerWidth;
  const availH = vv ? vv.height : window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(availW / VIEW_W, availH / VIEW_H);
  // 実ピクセルで整数倍になる倍率
  const intDevice = Math.floor(fit * dpr);
  let scale = intDevice >= 1 ? intDevice / dpr : fit;
  // 整数倍にすると小さくなりすぎる場合は、画面いっぱいを優先
  if (scale < fit * 0.85) scale = fit;
  stage.style.transform = `scale(${scale})`;
  stageWrap.style.width = `${Math.floor(VIEW_W * scale)}px`;
  stageWrap.style.height = `${Math.floor(VIEW_H * scale)}px`;
}
window.addEventListener('resize', fitStage);
window.visualViewport?.addEventListener('resize', fitStage);
fitStage();

// ---------------------------------------------------------------------------
// 画面遷移

function go(next: Screen): void {
  screen = next;
  for (const [name, el] of Object.entries(screens)) show(el, name === next);
  hud.showGameUi(next === 'game');
  show(pauseOverlay, false);
  if (next !== 'game') {
    renderer.resetCamera();
    // BGM はプレイ中だけ
    bgm.stop();
  }

  if (next === 'title') {
    renderTitle(screens.title, {
      onStart: () => {
        setupSeed = null;
        if (load().seenDisclaimer) go('setup');
        else go('disclaimer');
      },
      bgmOn: () => bgm.enabled,
      onToggleBgm: toggleBgm,
      onDisclaimer: () => {
        renderDisclaimer(screens.disclaimer, {
          firstTime: false,
          onOk: () => go('title'),
        });
        screen = 'disclaimer';
        for (const [name, el] of Object.entries(screens)) show(el, name === 'disclaimer');
      },
    });
  } else if (next === 'disclaimer') {
    const firstTime = !load().seenDisclaimer;
    renderDisclaimer(screens.disclaimer, {
      firstTime,
      onOk: () => {
        markDisclaimerSeen();
        go('setup');
      },
      onBack: () => go('title'),
    });
  } else if (next === 'setup') {
    renderSetup(screens.setup, sprites, {
      initial: allocation,
      seedLabel: setupSeed !== null ? `${setupSeed}（前回と同じ相場）` : urlSeed !== null ? `${urlSeed}（URLで指定）` : null,
      onStart: (a) => {
        allocation = a;
        startGame(setupSeed ?? urlSeed ?? randomSeed());
      },
      onBack: () => go('title'),
    });
  }
}

function startGame(seed: number): void {
  hud.clearComments();
  renderer.resetCamera();
  game = new Game(seed, allocation, {
    onLifeEvent: (outcome) => {
      resetHolds();
      hud.showLifeEvent(outcome, () => game?.resume());
    },
    onScenarioStart: (sc) => hud.banner(CONFIG.scenarios[sc.id].banner, sc.isCrash ? 'bad' : 'normal', 2.2),
    onFundBust: (b) => hud.banner(b.banner, 'bad', 2.4),
    onTrade: (type, recs) => hud.trade(type, recs),
    onCelebrate: () => {
      renderer.celebrate();
      hud.banner('前の高値を超えた！ 耐えた甲斐があった！', 'good', 2.2);
    },
    onEnd: (actions) => {
      const g = game!;
      bgm.stop();
      resetHolds();
      hud.banner('20年が経った…', 'normal', 1.5);
      setTimeout(() => {
        const res = evaluateGame(g.market, g.allocation, g.events, actions);
        lastResult = res;
        const isHigh = submitScore({
          finalValue: res.actual.totalAssets,
          profit: res.actual.profit,
          title: res.title.name,
          seed: res.seed,
        });
        go('result');
        renderResult(screens.result, sprites, g.market, res, isHigh, {
          onRetry: () => startGame(urlSeed ?? randomSeed()),
          onChangeSettings: () => {
            setupSeed = res.seed;
            go('setup');
          },
          onShare: () => share(res),
          onTitle: () => go('title'),
        });
      }, 1500);
    },
  });
  go('game');
  hud.setupChips(
    game,
    (f) => game?.sell(f),
    (f) => {
      // ファンドをタップした：ゲームを止めて、積立額とまとめ買いの額を選ぶ
      const g = game;
      if (!g || !isRunning()) return;
      resetHolds();
      g.paused = true;
      hud.showFundSettings(
        g,
        f,
        (plan, lump) => {
          g.paused = false;
          g.configureFund(f, plan, lump);
        },
        () => {
          g.paused = false;
        },
      );
    },
  );
  game.start();
  // 「はじめる」「もう一度」のクリックの中で呼ばれるので、自動再生の制限にかからない
  bgm.start();
}

async function share(res: GameResult): Promise<void> {
  const url = `${location.origin}${location.pathname}?seed=${res.seed}`;
  const text = [
    `【つみたて！】称号「${res.title.name}」`,
    `最終的な資産 ${man(res.actual.totalAssets)}（NISA ${man(res.actual.finalValue)}＋生活防衛資金 ${man(res.actual.emergencyFinal)}）`,
    `ずっと持ち続けていたら ${man(res.hold.totalAssets)}（差 ${manSigned(res.diffFromHold)}）`,
    `売却${res.actual.sellCount}回・手を離した${res.actual.letGoCount}回`,
    '※架空のシミュレーションです',
  ].join('\n');
  const full = `${text}\n${url}`;
  const btn = document.getElementById('r-share');
  try {
    if (navigator.share) {
      await navigator.share({ title: 'つみたて！', text, url });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(full);
    if (btn) btn.textContent = 'コピーしました！';
  } catch {
    // コピーもできない環境では、選択済みのテキストを表示して手でコピーしてもらう
    let box = document.getElementById('r-share-box') as HTMLTextAreaElement | null;
    if (!box) {
      box = document.createElement('textarea');
      box.id = 'r-share-box';
      box.className = 'share-box';
      box.readOnly = true;
      btn?.after(box);
    }
    box.value = full;
    box.focus();
    box.select();
  }
}

// ---------------------------------------------------------------------------
// 入力

// PC の S キー長押し＝積立中のファンドを全部売る（画面上のボタンは無し）
const sellAllHold = setupHoldButton(document.createElement('div'), CONFIG.controls.sellHoldMs, () => game?.sell());

function resetHolds(): void {
  sellAllHold.reset();
  hud.resetHolds();
}

const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

function isRunning(): boolean {
  return screen === 'game' && !!game && !game.paused && !game.userPaused && !game.finished;
}

function setPaused(p: boolean): void {
  if (!game || screen !== 'game' || game.finished) return;
  game.userPaused = p;
  if (p) {
    resetHolds();
    bgm.pause();
  } else bgm.resume();
  show(pauseOverlay, p);
}

// 画面のどこをタップしても握力回復（ボタン・モーダルの上は除く）
stage.addEventListener('pointerdown', (e) => {
  if (!isRunning() || !game) return;
  const target = e.target as HTMLElement;
  if (target.closest('button, .modal, .screen')) return;
  e.preventDefault();
  game.tap();
  const rect = stage.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
  const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
  renderer.tapFx(sx, sy);
});

window.addEventListener('keydown', (e) => {
  if (screen !== 'game' || !game) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) game.tap();
  } else if (e.code === 'KeyS') {
    if (!e.repeat && isRunning() && game.invested) sellAllHold.press();
  } else if (DIGIT_KEYS.includes(e.code)) {
    if (!e.repeat && isRunning()) hud.chip(DIGIT_KEYS.indexOf(e.code))?.press();
  } else if (e.code === 'KeyB') {
    if (isRunning()) game.resumeAll();
  } else if (e.code === 'KeyM') {
    if (!e.repeat) toggleBgm();
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!hud.modalOpen) setPaused(!game.userPaused);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyS') sellAllHold.release();
  if (DIGIT_KEYS.includes(e.code)) hud.chip(DIGIT_KEYS.indexOf(e.code))?.release();
});

$('pause-btn').addEventListener('click', () => setPaused(true));
$('bgm-btn').addEventListener('click', toggleBgm);
$('bgm-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
$('pause-bgm-btn').addEventListener('click', toggleBgm);
updateBgmButtons();
$('pause-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
$('resume-btn').addEventListener('click', () => setPaused(false));
$('quit-btn').addEventListener('click', () => {
  game = null;
  go('title');
});

// タブを離れたら一時停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRunning()) setPaused(true);
  // イベントのモーダル表示中などでも、裏で鳴りっぱなしにしない
  if (document.hidden) bgm.pause();
  else if (screen === 'game' && game && !game.userPaused && !game.finished) bgm.resume();
});

// ダブルタップ拡大・ピンチ・長押しメニューの抑止
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('contextmenu', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = performance.now();
    const target = e.target as HTMLElement;
    // ボタンのクリックは通す。それ以外の素早い連続タップでは既定動作（拡大）を止める
    if (now - lastTouchEnd < 350 && !target.closest('button')) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
document.addEventListener(
  'touchmove',
  (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.screen')) e.preventDefault();
  },
  { passive: false },
);

// ---------------------------------------------------------------------------
// ループ

let lastTime = performance.now();
let attractTime = 0;
function frame(now: number): void {
  const dtMs = Math.min(100, now - lastTime);
  lastTime = now;
  const dt = dtMs / 1000;
  if (screen === 'game' && game) {
    game.update(dtMs);
    const overlay = renderer.renderGame(game, dt);
    hud.update(game, overlay, dt);
  } else {
    attractTime += dt;
    renderer.renderAttract(attractTime, dt);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// 起動

go('title');
requestAnimationFrame(frame);
loadSprites().then((s) => {
  sprites = s;
  renderer.sprites = s;
  hud.setSprites(s);
});

// デバッグ用（コンソールから結果を確認できるように）
Object.assign(window as unknown as Record<string, unknown>, {
  __shigamitsuke: { get game() { return game; }, get result() { return lastResult; }, bgm },
});
