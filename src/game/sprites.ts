// スプライトの定義と読み込み。
// public/sprites/ に PNG を置けば自動で差し替わる。無ければドット絵風のプレースホルダーを描いて使う。
// 画像は大きいままでよい（読み込み時にゲーム内の大きさ SPRITE_HEIGHT へ縮小する）。
// HTML の画面（設定・イベント・結果）では、縮小前の元画像を使ってなめらかに表示する。

export type SpriteName = 'run' | 'run_happy' | 'shock' | 'cling' | 'cling_cry' | 'fall' | 'walk' | 'sad' | 'victory';

/** ゲーム内（360×640 の論理解像度）での主人公の高さ（px） */
export const SPRITE_HEIGHT = 80;

export interface SpriteDef {
  /** コマの画像ファイル（並び順＝再生順）。1枚に横並びで入っている場合は1つだけ書いて sheetFrames を指定 */
  files: string[];
  /** 1枚の画像に横並びで入っているコマ数 */
  sheetFrames?: number;
  /** アニメーション速度（コマ/秒） */
  fps: number;
  /** 画像が無いとき、代わりに使うスプライト */
  fallback?: SpriteName;
  /** 代わりのスプライトを使うときの速度 */
  fallbackFps?: number;
}

export const SPRITE_DEFS: Record<SpriteName, SpriteDef> = {
  // run07.png は run01.png と同じ画像なので、ループでは 01〜06 を使う（07 まで入れると立ちポーズが2コマ続く）
  run: { files: ['run01.png', 'run02.png', 'run03.png', 'run04.png', 'run05.png', 'run06.png'], fps: 11 },
  run_happy: { files: ['run_happy.png'], fps: 1 },
  shock: { files: ['shock.png'], fps: 1 },
  cling: { files: ['cling.png'], fps: 1 },
  cling_cry: { files: ['cling_cry.png'], fps: 1 },
  fall: { files: ['fall.png'], fps: 1, fallback: 'shock' },
  walk: { files: ['walk.png'], sheetFrames: 2, fps: 4, fallback: 'run', fallbackFps: 5 },
  sad: { files: ['sad.png'], fps: 1 },
  victory: { files: ['victory.png'], fps: 1 },
};

export interface Sprite {
  /** ゲーム内用に縮小したコマを横に並べた画像 */
  image: CanvasImageSource;
  frames: number;
  frameW: number;
  frameH: number;
  fps: number;
  placeholder: boolean;
  /** 縮小前の元画像（コマごと）。HTML の画面でなめらかに表示するのに使う */
  hiRes?: { image: CanvasImageSource; sx: number; sy: number; sw: number; sh: number }[];
}

export type SpriteSet = Record<SpriteName, Sprite>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('empty')));
    img.onerror = () => reject(new Error(`load failed: ${src}`));
    img.src = src;
  });
}

/** 大きな画像を、半分ずつ段階的に縮めてから目的の大きさにする（一気に縮めるより線がきれいに残る） */
function downscale(
  src: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  let cur = document.createElement('canvas');
  cur.width = sw;
  cur.height = sh;
  cur.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const next = document.createElement('canvas');
    next.width = Math.ceil(cur.width / 2);
    next.height = Math.ceil(cur.height / 2);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

async function loadSprite(def: SpriteDef, base: string): Promise<Sprite> {
  const images = await Promise.all(def.files.map((f) => loadImage(`${base}sprites/${f}`)));
  const hiRes: NonNullable<Sprite['hiRes']> = [];
  for (const img of images) {
    const n = def.files.length === 1 ? (def.sheetFrames ?? 1) : 1;
    const sw = Math.floor(img.naturalWidth / n);
    for (let i = 0; i < n; i++) hiRes.push({ image: img, sx: i * sw, sy: 0, sw, sh: img.naturalHeight });
  }
  const frameH = SPRITE_HEIGHT;
  const frameW = Math.round((hiRes[0].sw * frameH) / hiRes[0].sh);
  const sheet = document.createElement('canvas');
  sheet.width = frameW * hiRes.length;
  sheet.height = frameH;
  const ctx = sheet.getContext('2d')!;
  hiRes.forEach((f, i) => ctx.drawImage(downscale(f.image, f.sx, f.sy, f.sw, f.sh, frameW, frameH), i * frameW, 0));
  return { image: sheet, frames: hiRes.length, frameW, frameH, fps: def.fps, placeholder: false, hiRes };
}

export async function loadSprites(): Promise<SpriteSet> {
  const base = import.meta.env.BASE_URL ?? './';
  const names = Object.keys(SPRITE_DEFS) as SpriteName[];
  const loaded = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await loadSprite(SPRITE_DEFS[name], base).catch(() => null)] as const),
    ),
  ) as Record<SpriteName, Sprite | null>;

  // 画像が無いものは、代わりのスプライト → それも無ければプレースホルダー
  return Object.fromEntries(
    names.map((name) => {
      const own = loaded[name];
      if (own) return [name, own];
      const def = SPRITE_DEFS[name];
      const fb = def.fallback ? loaded[def.fallback] : null;
      if (fb) return [name, { ...fb, fps: def.fallbackFps ?? fb.fps }];
      return [name, makePlaceholder(name)];
    }),
  ) as SpriteSet;
}

/** 同期的に使えるプレースホルダーだけのセット（読み込み完了前の描画用） */
export function placeholderSprites(): SpriteSet {
  const names = Object.keys(SPRITE_DEFS) as SpriteName[];
  return Object.fromEntries(names.map((n) => [n, makePlaceholder(n)])) as SpriteSet;
}

export function spriteFrame(sprite: Sprite, timeSec: number): number {
  return Math.floor(timeSec * sprite.fps) % sprite.frames;
}

/**
 * スプライトを描く。anchor は (x, y) がスプライトのどこに来るか。
 * 'bottom' = 下端中央（足元）、'top' = 上端中央（手の位置）、'center' = 中心
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  frame: number,
  x: number,
  y: number,
  anchor: 'bottom' | 'top' | 'center' = 'bottom',
  rotation = 0,
): void {
  const w = sprite.frameW;
  const h = sprite.frameH;
  const ox = -w / 2;
  const oy = anchor === 'bottom' ? -h : anchor === 'top' ? 0 : -h / 2;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (rotation) ctx.rotate(rotation);
  ctx.drawImage(sprite.image, frame * w, 0, w, h, Math.round(ox), Math.round(oy), w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// プレースホルダー：32×32 のドットを 2倍で描いて 64×64 のコマにする
// 黒髪ショートボブ＋アホ毛、ミントのパーカー、社員証、グレーのスカート、白スニーカー（右向き）

const C = {
  hair: '#1d1b2c',
  hairHi: '#3a3654',
  skin: '#ffd9b8',
  skinSh: '#f0b894',
  blush: '#ff9fa8',
  eye: '#1d1b2c',
  white: '#ffffff',
  mint: '#8fe3c4',
  mintSh: '#5cbf9e',
  mintDk: '#3f9a7c',
  strap: '#e0475b',
  badge: '#f4f7ff',
  badgeLine: '#4a7bd8',
  skirt: '#8a8f9c',
  skirtSh: '#666b78',
  shoe: '#ffffff',
  shoeSh: '#b9bfcc',
  tear: '#7cc8ff',
  mouth: '#c74a5a',
};

type Face = 'normal' | 'happy' | 'shock' | 'cry' | 'worried' | 'sad' | 'up';
type Arms = 'swing0' | 'swing1' | 'up' | 'v' | 'flail' | 'hug' | 'down';
type Legs = 'run0' | 'run1' | 'run2' | 'run3' | 'hang' | 'jump' | 'walk0' | 'walk1' | 'stand';

interface Pose {
  face: Face;
  arms: Arms;
  legs: Legs;
  /** 全体の上下オフセット（ドット） */
  dy?: number;
}

function paintGirl(ctx: CanvasRenderingContext2D, ox: number, pose: Pose): void {
  const dy = pose.dy ?? 0;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect((ox + x) * 2, (y + dy) * 2, w * 2, h * 2);
  };

  // 腕（上げるポーズは頭の後ろに描く）
  const armUp = pose.arms === 'up' || pose.arms === 'v' || pose.arms === 'flail';
  if (armUp) {
    if (pose.arms === 'up') {
      px(12, 1, 3, 15, C.mintSh);
      px(19, 1, 3, 15, C.mintSh);
      px(12, 0, 3, 2, C.skin);
      px(19, 0, 3, 2, C.skin);
    } else if (pose.arms === 'v') {
      px(9, 5, 3, 3, C.mintSh);
      px(10, 8, 3, 8, C.mintSh);
      px(8, 3, 3, 2, C.skin);
      px(21, 5, 3, 3, C.mintSh);
      px(20, 8, 3, 8, C.mintSh);
      px(22, 3, 3, 2, C.skin);
    } else {
      px(7, 9, 4, 3, C.mintSh);
      px(9, 11, 3, 5, C.mintSh);
      px(5, 7, 3, 2, C.skin);
      px(22, 4, 3, 3, C.mintSh);
      px(21, 7, 3, 9, C.mintSh);
      px(23, 2, 3, 2, C.skin);
    }
  }

  // 脚と靴
  const leg = (x: number, top: number, len: number, shoeDx: number) => {
    px(x, top, 2, len, C.skin);
    px(x + shoeDx, top + len, 3, 2, C.shoe);
    px(x + shoeDx, top + len + 1, 3, 1, C.shoeSh);
  };
  switch (pose.legs) {
    case 'run0':
      leg(11, 27, 2, -1);
      leg(18, 27, 2, 1);
      break;
    case 'run1':
      leg(14, 27, 2, 0);
      leg(16, 27, 1, 1);
      break;
    case 'run2':
      leg(12, 27, 2, 0);
      leg(17, 27, 2, 1);
      break;
    case 'run3':
      leg(16, 27, 2, 0);
      leg(14, 27, 1, 0);
      break;
    case 'hang':
      leg(13, 27, 3, 0);
      leg(17, 27, 2, 0);
      break;
    case 'jump':
      leg(12, 27, 1, -1);
      leg(18, 26, 2, 1);
      break;
    case 'walk0':
      leg(13, 27, 2, 0);
      leg(17, 27, 2, 1);
      break;
    case 'walk1':
      leg(15, 27, 2, 0);
      leg(16, 27, 2, 1);
      break;
    default:
      leg(13, 27, 2, 0);
      leg(17, 27, 2, 0);
  }

  // スカート
  px(11, 24, 11, 3, C.skirt);
  px(11, 26, 11, 1, C.skirtSh);
  px(14, 24, 1, 3, C.skirtSh);
  px(18, 24, 1, 3, C.skirtSh);

  // パーカー（オーバーサイズ）とフード
  px(8, 15, 5, 3, C.mintSh);
  px(10, 16, 13, 8, C.mint);
  px(10, 23, 13, 1, C.mintSh);
  px(14, 21, 7, 2, C.mintSh);
  px(10, 16, 1, 8, C.mintSh);
  // 社員証のストラップ
  px(16, 16, 1, 1, C.strap);
  px(17, 17, 1, 1, C.strap);
  px(18, 18, 1, 1, C.strap);
  px(18, 19, 3, 3, C.badge);
  px(18, 20, 3, 1, C.badgeLine);

  // 下ろした腕・振る腕
  if (!armUp) {
    switch (pose.arms) {
      case 'swing0':
        px(12, 17, 3, 5, C.mintDk);
        px(12, 22, 2, 2, C.skin);
        px(20, 17, 3, 3, C.mintSh);
        px(22, 19, 3, 2, C.mintSh);
        px(24, 19, 2, 2, C.skin);
        break;
      case 'swing1':
        px(9, 17, 3, 3, C.mintDk);
        px(8, 19, 2, 2, C.skin);
        px(19, 17, 3, 6, C.mintSh);
        px(19, 23, 2, 2, C.skin);
        break;
      case 'hug':
        px(17, 18, 6, 3, C.mintSh);
        px(22, 19, 2, 2, C.skin);
        break;
      default:
        px(12, 17, 3, 6, C.mintDk);
        px(12, 23, 2, 2, C.skin);
        px(19, 17, 3, 6, C.mintSh);
        px(20, 23, 2, 2, C.skin);
    }
  }

  // 頭：ボブ（後ろ髪）→顔→前髪
  px(10, 5, 12, 3, C.hair);
  px(9, 8, 13, 8, C.hair);
  px(9, 15, 5, 1, C.hair);
  px(14, 9, 8, 7, C.skin);
  px(14, 15, 8, 1, C.skinSh);
  px(13, 7, 10, 2, C.hair);
  px(20, 9, 2, 1, C.hair);
  px(11, 6, 3, 1, C.hairHi);
  // アホ毛
  px(16, 4, 1, 1, C.hair);
  px(17, 3, 1, 1, C.hair);
  px(18, 2, 2, 1, C.hair);

  // 顔
  const face = pose.face;
  if (face === 'happy') {
    px(18, 12, 1, 1, C.eye);
    px(19, 11, 1, 1, C.eye);
    px(20, 12, 1, 1, C.eye);
    px(19, 14, 2, 1, C.mouth);
    px(20, 15, 1, 1, C.mouth);
  } else if (face === 'shock') {
    px(18, 10, 3, 3, C.white);
    px(19, 11, 1, 1, C.eye);
    px(19, 14, 2, 2, C.eye);
    px(23, 8, 1, 2, C.tear);
    px(22, 10, 1, 1, C.tear);
  } else if (face === 'cry') {
    px(18, 11, 3, 1, C.eye);
    px(19, 12, 1, 4, C.tear);
    px(17, 13, 1, 2, C.tear);
    px(20, 14, 2, 1, C.mouth);
  } else if (face === 'worried') {
    px(18, 10, 2, 1, C.eye);
    px(19, 11, 1, 2, C.eye);
    px(19, 14, 2, 1, C.eye);
    px(23, 9, 1, 2, C.tear);
  } else if (face === 'sad') {
    px(18, 12, 2, 1, C.eye);
    px(20, 14, 1, 1, C.mouth);
  } else if (face === 'up') {
    px(19, 10, 1, 2, C.eye);
    px(20, 14, 1, 1, C.mouth);
  } else {
    px(19, 11, 1, 2, C.eye);
    px(20, 14, 1, 1, C.mouth);
  }
  if (face !== 'shock') px(20, 13, 1, 1, C.blush);
}

function paintSad(ctx: CanvasRenderingContext2D, ox: number): void {
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect((ox + x) * 2, y * 2, w * 2, h * 2);
  };
  // 膝を抱えて座る
  px(10, 27, 12, 3, C.skirt);
  px(19, 22, 4, 7, C.skin);
  px(21, 28, 4, 2, C.shoe);
  px(21, 29, 4, 1, C.shoeSh);
  px(9, 18, 12, 10, C.mint);
  px(9, 27, 12, 1, C.mintSh);
  px(16, 21, 3, 1, C.strap);
  // 頭（うつむき）
  px(9, 10, 12, 9, C.hair);
  px(14, 13, 7, 6, C.skin);
  px(13, 11, 9, 3, C.hair);
  px(16, 9, 1, 1, C.hair);
  px(17, 8, 2, 1, C.hair);
  px(17, 15, 2, 1, C.eye);
  px(18, 16, 1, 2, C.tear);
  // 膝を抱える腕
  px(15, 21, 8, 3, C.mintSh);
  px(22, 22, 2, 2, C.skin);
}

const POSES: Record<SpriteName, Pose[] | 'sad'> = {
  run: [
    { face: 'normal', arms: 'swing0', legs: 'run0' },
    { face: 'normal', arms: 'down', legs: 'run1', dy: -1 },
    { face: 'normal', arms: 'swing1', legs: 'run2' },
    { face: 'normal', arms: 'down', legs: 'run3', dy: -1 },
  ],
  run_happy: [{ face: 'happy', arms: 'swing0', legs: 'run0' }],
  shock: [{ face: 'shock', arms: 'flail', legs: 'stand' }],
  cling: [{ face: 'worried', arms: 'up', legs: 'hang', dy: 2 }],
  cling_cry: [{ face: 'cry', arms: 'up', legs: 'hang', dy: 2 }],
  fall: [{ face: 'shock', arms: 'flail', legs: 'jump' }],
  walk: [
    { face: 'up', arms: 'down', legs: 'walk0' },
    { face: 'up', arms: 'down', legs: 'walk1', dy: -1 },
  ],
  sad: 'sad',
  victory: [{ face: 'happy', arms: 'v', legs: 'jump' }],
};

function makePlaceholder(name: SpriteName): Sprite {
  const def = SPRITE_DEFS[name];
  const poses = POSES[name];
  const frames = poses === 'sad' ? 1 : poses.length;
  const canvas = document.createElement('canvas');
  canvas.width = 64 * frames;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (poses === 'sad') paintSad(ctx, 0);
  else poses.forEach((p, i) => paintGirl(ctx, i * 32, p));
  return { image: canvas, frames, frameW: 64, frameH: 64, fps: def.fps, placeholder: true };
}
