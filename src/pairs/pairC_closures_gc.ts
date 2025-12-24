import type { Pair } from "./types";

type InputC = {
  n: number;
  iters: number;
};

/**
 * ペアC: クロージャ / 割り当て圧（GC）
 *
 * - slow: ホットループ内でクロージャと小オブジェクトを生成する
 * - fast: 反復ごとの割り当てを避ける（または生成をループ外へ移動する）
 */

export function pairC_slow(input: InputC): number {
  const n = input.n;
  const iters = input.iters;

  let acc = 0;
  for (let k = 0; k < iters; k++) {
    const fns: Array<() => number> = [];
    for (let i = 0; i < n; i++) {
      // 反復ごとの割り当て: クロージャ + キャプチャされる小オブジェクト
      const box = { v: i };
      fns.push(() => box.v + 1);
    }
    for (let i = 0; i < fns.length; i++) {
      acc += fns[i]();
    }
  }
  return acc;
}

export function pairC_fast(input: InputC): number {
  const n = input.n;
  const iters = input.iters;

  // クロージャ生成をホットループ外へ移動し、可変な値を読む単一クロージャを再利用する。
  const box = { v: 0 };
  const fn = () => box.v + 1;

  let acc = 0;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      box.v = i;
      acc += fn();
    }
  }
  return acc;
}

export const pairC: Pair<InputC, number> = {
  id: "pairC",
  title: "Pair C: クロージャ/割り当て圧（allocation、GC）",
  makeInput(seed: number) {
    const n = 20_000 + (seed % 3) * 5000;
    const iters = 10;
    return { n, iters };
  },
  slow: pairC_slow,
  fast: pairC_fast,
};


