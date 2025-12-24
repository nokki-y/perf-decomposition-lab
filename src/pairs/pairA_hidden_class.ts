import type { Pair } from "./types";

type InputA = {
  n: number;
  iters: number;
};

/**
 * ペアA: hidden class（Map）/ プロパティアクセス
 *
 * このペアで見たいこと（超重要）:
 * - JavaScript のオブジェクトは、V8 内部で「Map（= hidden class / 形状）」を持つ
 * - Map は「どのプロパティを持つか」「どの順序で追加されたか」「削除されたか」などで変わり得る
 * - 同じ場所（例: `o.a`）でも、実行中に「違う Map のオブジェクト」が来ると、
 *   その場所のフィードバック（IC）が単一（MONOMORPHIC）から複数（POLYMORPHIC）へ広がりやすい
 * - POLYMORPHIC 化すると、最適化コード内で分岐や汎用処理が増えやすく、遅くなりがち
 *
 * ここで言う「揺れ」とは:
 * - **同じ用途のオブジェクト**なのに、実行中に **複数の Map（形状）**に分裂してしまうこと
 * - 例: `o = {a,b,c}` と `o = {b,a,c}`、さらに `delete` の有無で別 Map になり得る
 *
 * 実装の狙い:
 * - slow: Map を意図的に「揺らす」（初期化順の変更、追加/削除、再追加）→ IC が多相化しやすい
 * - fast: Map を固定しやすくする（同じプロパティ集合・同じ追加順・再利用）→ IC が単相になりやすい
 *
 * 何をログで見るか（最短）:
 * - `artifacts/v8-logs/pairA-*.stdout-stderr.txt`: `marking ... TURBOFAN` / `completed optimizing`（最適化されたか）
 * - `artifacts/v8-logs/pairA-*.debugprint.txt`: `LoadProperty MONOMORPHIC` / `... POLYMORPHIC`（IC の状態）
 */

export function pairA_slow(input: InputA): number {
  const n = input.n;
  const iters = input.iters;
  let acc = 0;

  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      /**
       * ここが「揺れ」を作る本体。
       *
       * ポイント:
       * - **初期化順の変更**: `{a,b,c}` と `{b,a,c}` のように順序を変える
       *   - V8 はプロパティ追加の順序も Map に織り込むため、別 Map になり得る
       * - **delete の混入**: `delete o.b` / `delete o.c`
       *   - delete は「辞書モード（遅い表現）」へ落ちやすい要因で、最適化を邪魔しやすい
       *   - その後に `o.b = ...` のように再追加すると、また別の遷移を踏みやすい
       *
       * これにより、後段の `o.a` / `o.b` / `o.c` / `o.d` の読み出し箇所が
       * 「同じ場所なのに複数 Map を見る」状態になりやすい（= 揺れ）。
       */
      let o: any;
      if ((i & 1) === 0) {
        // パターン1: a→b→c の順で初期化
        o = { a: i, b: i + 1, c: i + 2 };
        // 後から d を追加（追加順が固定されないと Map が増える）
        o.d = i + 3;
        // delete を混ぜて Map を揺らす（その後に再追加）
        delete o.b;
        o.b = i + 1;
      } else {
        // パターン2: b→a→c の順で初期化（パターン1と異なる Map になり得る）
        o = { b: i + 1, a: i, c: i + 2 };
        o.d = i + 3;
        delete o.c;
        o.c = i + 2;
      }
      /**
       * ここが「観測したい場所」。
       * - `o.a` などのプロパティロードが、IC の観点で MONOMORPHIC を維持できるか？それとも POLYMORPHIC になるか？
       * - slow では Map が揺れるので、多相化しやすい（= ここが遅くなりがち）
       */
      acc += o.a + o.b + o.c + o.d;
    }
  }

  return acc;
}

export function pairA_fast(input: InputA): number {
  const n = input.n;
  const iters = input.iters;

  /**
   * fast 版の方針:
   * - 形状（Map）を固定したいので、最初に `{a,b,c,d}` を**同じ順序**で作る
   * - ループ内では「プロパティを書き換えるだけ」にして、プロパティの増減や delete をしない
   * - さらにオブジェクトをプールして再利用し、Map の分裂を起こしにくくする
   */
  const pool: { a: number; b: number; c: number; d: number }[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // a→b→c→d の順で必ず初期化（固定形状を作る）
    pool[i] = { a: 0, b: 0, c: 0, d: 0 };
  }

  let acc = 0;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      const o = pool[i];
      // ここでは「既存プロパティの更新」だけを行う（追加/削除しない）
      o.a = i;
      o.b = i + 1;
      o.c = i + 2;
      o.d = i + 3;
      // 読み出し側も同じ Map を見続けやすいので、MONOMORPHIC になりやすい
      acc += o.a + o.b + o.c + o.d;
    }
  }
  return acc;
}

export const pairA: Pair<InputA, number> = {
  id: "pairA",
  title: "Pair A: hidden class（Map）とプロパティアクセス",
  makeInput(seed: number) {
    // シードはサイズを決定的に変えるためだけに使う。
    const n = 500 + (seed % 7) * 50;
    const iters = 20;
    return { n, iters };
  },
  slow: pairA_slow,
  fast: pairA_fast,
};


