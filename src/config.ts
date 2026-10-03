// 調整用の数値はすべてここにまとめる。
// 金額はすべて「円」で持つ。

export type ScenarioId = 'dokan' | 'zuruzuru' | 'oufuku' | 'yokobai';

export interface ScenarioConfig {
  /** ゲーム内表示名 */
  name: string;
  /** 画面に出す一言 */
  banner: string;
  /** 暴落扱いか（ライフイベントの発生率アップ・握力に関係） */
  isCrash: boolean;
  /** 直前の水準からの下落幅（0.3 = −30%） */
  depth: number;
  /** 下落にかける月数 [最小, 最大] */
  declineMonths: [number, number];
  /** 回復（横ばい地獄は停滞）にかける月数 [最小, 最大] */
  recoveryMonths: [number, number];
  /** シナリオ期間中のベースの値動きのドリフト倍率（0 で上がりも下がりもしない） */
  driftScale: number;
  /** シナリオ期間中のベースの値動きのボラティリティ倍率 */
  volScale: number;
  /** 往復ビンタ型：1回目の下げ幅 */
  firstDip?: number;
  /** 往復ビンタ型：戻した後の水準（直前比の下落幅） */
  reboundTo?: number;
}

export interface LifeEventConfig {
  id: string;
  name: string;
  cost: number;
  /** 抽選の重み */
  weight: number;
}

export const CONFIG = {
  /** 本編の月数（20年） */
  months: 240,

  money: {
    /** 毎月の余裕資金 */
    monthlyBudget: 50_000,
    /** 配分の単位 */
    allocationUnit: 10_000,
    /** 積立額の初期値 */
    defaultInvest: 40_000,
    /** 積立額の下限（0にするとゲームにならないため） */
    minInvest: 10_000,
    /** 生活防衛資金の初期値 */
    initialEmergencyFund: 300_000,
  },

  market: {
    /** ファンドの初期基準価額 */
    initialPrice: 10_000,
    /** 年率リターン（対数成長の中央値として使う） */
    annualReturn: 0.05,
    /** 年率ボラティリティ */
    annualVolatility: 0.15,
    /** 20年間に差し込むシナリオの数 */
    scenarioCount: { min: 2, max: 3 },
    /** 必ず1回入れるシナリオ */
    mandatoryScenario: 'zuruzuru' as ScenarioId,
    /** 最初のシナリオが始まる最も早い月 */
    earliestStartMonth: 12,
    /** シナリオ同士の最小間隔（月） */
    minGapMonths: 6,
  },

  scenarios: {
    dokan: {
      name: 'ドカン型',
      banner: 'ドカン型の暴落！',
      isCrash: true,
      depth: 0.3,
      declineMonths: [1, 2],
      recoveryMonths: [5, 7],
      driftScale: 1,
      volScale: 0.4,
    },
    zuruzuru: {
      name: 'ずるずる型',
      banner: 'ずるずる型の暴落が始まった…',
      isCrash: true,
      depth: 0.5,
      declineMonths: [12, 18],
      recoveryMonths: [48, 60],
      driftScale: 1,
      volScale: 0.6,
    },
    oufuku: {
      name: '往復ビンタ型',
      banner: '往復ビンタ型の暴落！',
      isCrash: true,
      depth: 0.25,
      firstDip: 0.17,
      reboundTo: 0.07,
      declineMonths: [6, 6],
      recoveryMonths: [22, 26],
      driftScale: 1,
      volScale: 0.5,
    },
    yokobai: {
      name: '横ばい地獄',
      banner: '横ばい地獄に突入…',
      isCrash: false,
      depth: 0,
      declineMonths: [0, 0],
      recoveryMonths: [36, 48],
      driftScale: 0,
      volScale: 0.3,
    },
  } satisfies Record<ScenarioId, ScenarioConfig>,

  lifeEvents: {
    list: [
      { id: 'wedding', name: '友達の結婚式が3件重なった', cost: 100_000, weight: 3 },
      { id: 'phone', name: 'スマホが壊れた', cost: 150_000, weight: 3 },
      { id: 'move', name: '引っ越し', cost: 400_000, weight: 2 },
      { id: 'jobless', name: '転職活動で無収入期間', cost: 600_000, weight: 1 },
      { id: 'hospital', name: '入院した', cost: 300_000, weight: 2 },
    ] as LifeEventConfig[],
    /** 最初のイベントが起きうる最も早い月 */
    earliestMonth: 12,
    /** イベント同士の最小間隔（月） */
    minGapMonths: 12,
    /** 平常時の毎月の発生確率 */
    baseMonthlyProb: 1 / 30,
    /** 暴落中（下落〜底〜回復前半）の発生確率の倍率 */
    crashProbMultiplier: 4,
    /** ずるずる型の下落〜底の時期に、イベントを1回ねじ込む確率 */
    forceInMajorCrashProb: 0.7,
  },

  grip: {
    max: 100,
    /** このドローダウンを超えると握力が減り始める */
    drawdownThreshold: 0.1,
    /** 減る速さ（毎秒）= coef × ドローダウン × (steepFloor + 直近1か月の下落率) */
    decayCoef: 400,
    /** 底で横ばいでも少しずつ減るようにする下駄 */
    steepFloor: 0.04,
    /** 1タップで回復する量 */
    tapRecover: 4,
    /** 平常時に毎秒回復する量 */
    regenPerSec: 30,
  },

  time: {
    /** 1か月あたりの実時間（ミリ秒） */
    msPerMonth: 750,
    /** 暴落中の時間の進み */
    crashSpeed: 0.5,
    /** このドローダウンを超えたら減速 */
    crashSpeedDrawdown: 0.1,
    /** 速度変化のなめらかさ（大きいほど速く切り替わる） */
    speedLerpPerSec: 4,
    /** 1フレームで進められる最大時間（タブ復帰時の暴走防止） */
    maxFrameMs: 100,
  },

  controls: {
    /** 「売る」の長押し時間 */
    sellHoldMs: 1000,
  },

  effects: {
    /** 画面の縁が赤くなり始めるドローダウン */
    redEdgeStart: 0.1,
    /** 赤みが最大になるドローダウン */
    redEdgeFull: 0.45,
    /** 点滅し始めるドローダウン */
    blinkFrom: 0.2,
    /** 画面揺れが始まるドローダウン */
    shakeFrom: 0.2,
    /** 揺れの最大幅（論理px） */
    shakeMax: 4,
    /** コメントの段階を切り替えるドローダウン */
    commentTiers: [0.1, 0.2, 0.35],
    /** 段階ごとのコメント出現数（毎秒） */
    commentRatePerSec: [0.7, 1.6, 3.2],
    /** 同時に流れるコメントの上限 */
    commentMax: 14,
    /** 段階ごとのコメントが画面を横切る時間（秒） */
    commentDurationSec: [6, 4.5, 3],
    /** 祝福演出を出すのに必要な、直前の下落の深さ */
    celebrateAfterDrawdown: 0.1,
  },

  tax: {
    /** 課税口座の税率 */
    rate: 0.20315,
  },

  titles: {
    /** 底で売る天才：最も深い暴落の底からの許容月数 */
    bottomWindowMonths: 2,
    /** 生活に負けた人：強制売却合計のしきい値 */
    lifeLoserThreshold: 300_000,
    /** タイミングの魔術師：売却と買い戻しの回数 */
    timingWizardCount: 3,
  },

  storageKey: 'shigamitsuke.v1',
};

export type Config = typeof CONFIG;
