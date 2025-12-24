import type { Pair, PairId, VariantId } from "./types";
import { pairA } from "./pairA_hidden_class";
import { pairB } from "./pairB_arrays";
import { pairC } from "./pairC_closures_gc";

export const pairs = [pairA, pairB, pairC] as const satisfies readonly Pair<any, any>[];

export function getPair(id: PairId): Pair<any, any> {
  const p = pairs.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown pair: ${id}`);
  return p;
}

export function variantsOf(request: VariantId | "both"): VariantId[] {
  if (request === "both") return ["slow", "fast"];
  return [request];
}


