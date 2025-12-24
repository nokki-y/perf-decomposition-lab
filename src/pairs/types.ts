export type PairId = "pairA" | "pairB" | "pairC";
export type VariantId = "slow" | "fast";

export interface Pair<I, O> {
  id: PairId;
  title: string;
  /**
   * 入力を決定的（deterministic）に生成する。
   * 遅い/速いの両実装で同一入力を使い、比較できるようにする。
   */
  makeInput(seed: number): I;
  slow(input: I): O;
  fast(input: I): O;
}


