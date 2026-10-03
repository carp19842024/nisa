// 調整用の数値はすべてここにまとめる。
// 金額はすべて「円」で持つ。

export type ScenarioId = 'dokan' | 'zuruzuru' | 'oufuku' | 'yokobai';

export type FundId = 'zenbu' | 'rocket' | 'mattari' | 'gold';

export interface FundConfig {
  id: FundId;
  name: string;
  /** ボタンなど狭い場所での表示名 */
  short: string;
  /** 一言説明 */
  desc: string;
  /** チャートなどの色 */
  color: string;
  /** 年率リターン（対数成長の中央値。信託報酬を引いた後） */
  annualReturn: number;
  /** 市場全体のふだんの値動きへの感応度 */
  beta: number;
  /** 暴落シナリオの効き方（1 = 市場と同じ、0.5 = 半分、マイナスなら逆に上がる） */
  crashBeta: number;
  /** ファンド独自の値動き（年率ボラティリティ） */
  idioVol: number;
  /** 信託報酬（年率）。値動きには織り込み済みで、結果画面の「手数料」表示に使う */
  fee: number;
  /** ブレの大きさの目安（★の数） */
  risk: number;
}

/** テーマ型ファンド独自の暴落（ブーム終了） */
export interface FundBustConfig {
  fund: FundId;
  name: string;
  banner: string;
  /** 20年のうちに起きる確率 */
  prob: number;
  depth: number;
  declineMonths: [number, number];
  /** 底のあと、ほとんど戻らずに停滞する月数 */
  stagnantMonths: [number, number];
  /** この月より後に起きる */
  earliestMonth: number;
}

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
    /** 積立額の初期値（ファンドごと） */
    defaultInvest: { zenbu: 40_000 } as Partial<Record<FundId, number>>,
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

  /** 積立できるファンド（すべて架空）。並び順は画面の表示順 */
  funds: [
    {
      id: 'zenbu',
      name: 'ぜんぶ入りファンド',
      short: 'ぜんぶ入り',
      desc: '世界中の株にまるごと投資。王道。',
      color: '#8fe3c4',
      annualReturn: 0.05,
      beta: 1,
      crashBeta: 1,
      idioVol: 0,
      fee: 0.001,
      risk: 3,
    },
    {
      id: 'rocket',
      name: 'ロケットテックファンド',
      short: 'ロケット',
      desc: '流行りのテーマに集中投資。当たれば大きい。',
      color: '#ff8fb1',
      annualReturn: 0.075,
      beta: 1.4,
      crashBeta: 1.5,
      idioVol: 0.18,
      fee: 0.015,
      risk: 5,
    },
    {
      id: 'mattari',
      name: 'まったりバランスファンド',
      short: 'バランス',
      desc: '株と債券が半分ずつ。値動きはおだやか。',
      color: '#7cc8ff',
      annualReturn: 0.03,
      beta: 0.45,
      crashBeta: 0.45,
      idioVol: 0.02,
      fee: 0.003,
      risk: 2,
    },
    {
      id: 'gold',
      name: 'キンキラ金ファンド',
      short: 'ゴールド',
      desc: '金に投資。株の暴落中は逆に上がりやすい。',
      color: '#ffd166',
      annualReturn: 0.025,
      beta: -0.05,
      crashBeta: -0.35,
      idioVol: 0.13,
      fee: 0.004,
      risk: 3,
    },
  ] as FundConfig[],

  /** 一覧には出るが、NISAでは買えないファンド（小ネタ） */
  ineligibleFunds: [{ name: '毎月もらえる分配ファンド', reason: '毎月分配型はNISAでは買えません' }],

  fundBusts: [
    {
      fund: 'rocket',
      name: 'ブーム終了',
      banner: 'ロケットテック：ブーム終了…',
      prob: 0.55,
      depth: 0.55,
      declineMonths: [6, 10],
      stagnantMonths: [36, 60],
      earliestMonth: 24,
    },
  ] as FundBustConfig[],

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
    /** 分散の達人：積立したファンドの本数 */
    diversifiedFunds: 3,
    /** ロケットに夢を見た人／金の亡者：積立額に占める割合 */
    heavyShare: 0.5,
  },

  audio: {
    /** プレイ中の BGM（public/ からの相対パス） */
    bgmFile: 'audio/bgm.mp3',
    bgmVolume: 0.45,
  },

  storageKey: 'shigamitsuke.v1',
};

export type Config = typeof CONFIG;
