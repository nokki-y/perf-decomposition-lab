import type { Pair } from "./types";

type InputB = {
  n: number;
  iters: number;
};

/**
 * ペアB: 配列（packed vs holey、型混在）
 *
 * - slow: 穴（hole）と型混在を作り、elements kind の遷移や追加チェックを増やしやすくする
 * - fast: 密な数値配列を維持し、直線的に反復する
 */

export function pairB_slow(input: InputB): number {
  const n = input.n;
  const iters = input.iters;

  // 穴あき配列を作る: 奇数インデックスを穴のまま残す。
  const arr = new Array<any>(n);
  for (let i = 0; i < n; i++) {
    if ((i & 1) === 0) arr[i] = i;
    // 奇数インデックスは未代入（穴）
  }

  // 型を混在させる（ただし奇数インデックス側だけに入れて、速い版と合計値が一致するようにする）。
  // これにより型チェックや汎用的な要素アクセスが増えやすい。
  if (n > 7) {
    arr[3] = "x";
    arr[5] = null;
    arr[7] = undefined;
  }

  let acc = 0;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      // 速い経路: 数値 / 遅い経路: それ以外 または 穴
      if (typeof v === "number") acc += v;
    }
  }

  return acc;
}

export function pairB_fast(input: InputB): number {
  const n = input.n;
  const iters = input.iters;

  // 密な数値配列を事前確保する。
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = (i & 1) === 0 ? i : 0;

  let acc = 0;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      acc += arr[i];
    }
  }
  return acc;
}

export const pairB: Pair<InputB, number> = {
  id: "pairB",
  title: "Pair B: 配列（packed vs holey、型混在）",
  makeInput(seed: number) {
    const n = 10_000 + (seed % 5) * 1000;
    const iters = 30;
    return { n, iters };
  },
  slow: pairB_slow,
  fast: pairB_fast,
};


