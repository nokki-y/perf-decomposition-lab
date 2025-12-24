import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import assert from "node:assert/strict";

import { pairs, getPair, variantsOf } from "./pairs";
import type { PairId, VariantId } from "./pairs/types";
import { runBench, v8EnvSummary } from "./harness/bench";

type Command = "bench" | "hot" | "help";

type ParsedArgs = {
  command: Command;
  pair: PairId | "all";
  variant: VariantId | "both";
  warmup: number;
  iters: number;
  repeats: number;
  seed: number;
  loops: number;
  writeArtifacts: boolean;
  format: "table" | "json";
};

function parseArgs(argv: string[]): ParsedArgs {
  const command = (argv[2] as Command | undefined) ?? "help";

  const defaults: ParsedArgs = {
    command: command ?? "help",
    pair: "all",
    variant: "both",
    warmup: 1500,
    iters: 2500,
    repeats: 5,
    seed: 1,
    loops: 200_000,
    writeArtifacts: false,
    format: "table",
  };

  const argMap = new Map<string, string>();
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith("--")) {
      argMap.set(key, v);
      i++;
    } else {
      argMap.set(key, "true");
    }
  }

  const pair = (argMap.get("pair") ?? defaults.pair) as ParsedArgs["pair"];
  const variant = (argMap.get("variant") ?? defaults.variant) as ParsedArgs["variant"];

  const warmup = Number(argMap.get("warmup") ?? defaults.warmup);
  const iters = Number(argMap.get("iters") ?? defaults.iters);
  const repeats = Number(argMap.get("repeats") ?? defaults.repeats);
  const seed = Number(argMap.get("seed") ?? defaults.seed);
  const loops = Number(argMap.get("loops") ?? defaults.loops);
  const writeArtifacts = (argMap.get("write-artifacts") ?? "false") === "true";
  const format = (argMap.get("format") ?? defaults.format) as ParsedArgs["format"];

  return {
    ...defaults,
    command,
    pair,
    variant,
    warmup,
    iters,
    repeats,
    seed,
    loops,
    writeArtifacts,
    format,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, obj: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function runHot<I, O>(fn: (input: I) => O, input: I, loops: number): O {
  let out!: O;
  for (let i = 0; i < loops; i++) out = fn(input);
  return out;
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.command === "help" || (args.command !== "bench" && args.command !== "hot")) {
    console.log(
      [
        "Usage:",
        "  node dist/js/cli.js bench --pair <pairA|pairB|pairC|all> --variant <slow|fast|both> [--warmup N --iters N --repeats N --seed N] [--format table|json] [--write-artifacts]",
        "  node dist/js/cli.js hot  --pair <pairA|pairB|pairC>     --variant <slow|fast>      [--loops N --seed N]",
      ].join("\n"),
    );
    process.exitCode = 0;
    return;
  }

  if (args.command === "hot") {
    assert.ok(args.pair !== "all", "--pair must be a concrete pair for hot");
    assert.ok(args.variant !== "both", "--variant must be slow or fast for hot");

    const pair = getPair(args.pair);
    // エンジン最適化/逆アセンブル相当の観測では関数呼び出し回数を稼ぎたいが、1回の処理は「小さめ」にして実行時間を現実的に保つ。
    // そのためベンチ（計測）のデフォルト入力より小さい入力を使う。
    const input = (() => {
      switch (pair.id) {
        case "pairA":
          // 形状揺れ（ノイズ）は残しつつ、割り当て量/時間は抑える。
          return { n: 200, iters: 2 };
        case "pairB":
          return { n: 20_000, iters: 1 };
        case "pairC":
          return { n: 800, iters: 1 };
        default:
          return pair.makeInput(args.seed);
      }
    })() as any;
    const fn = args.variant === "slow" ? pair.slow : pair.fast;
    const out = runHot(fn, input, args.loops);
    // 出力が安定していることを示すため、結果を必ず表示する（簡易な正しさ確認）。
    console.log(JSON.stringify({ ts: nowIso(), pair: pair.id, variant: args.variant, out }));
    return;
  }

  // ベンチ（計測）
  const selectedPairs = args.pair === "all" ? pairs : [getPair(args.pair)];
  const selectedVariants = variantsOf(args.variant);

  const results: any[] = [];
  for (const p of selectedPairs) {
    const input = p.makeInput(args.seed);
    for (const v of selectedVariants) {
      const fn = v === "slow" ? p.slow : p.fast;
      const outOnce = fn(input);

      // 簡易サニティ: 遅い/速いは比較可能なはず（厳密な同一性はテストが担保する）。
      assert.ok(typeof outOnce === "number", "Output should be a number for these samples");

      const summary = runBench(fn, input, {
        warmupIterations: args.warmup,
        measureIterations: args.iters,
        repeats: args.repeats,
        seed: args.seed,
      });

      results.push({
        pair: p.id,
        variant: v,
        out: outOnce,
        ...summary,
      });
    }
  }

  const report = {
    ts: nowIso(),
    env: v8EnvSummary(),
    args,
    results,
  };

  if (args.writeArtifacts) {
    const outPath = resolve(join("artifacts", "bench", "bench.json"));
    writeJson(outPath, report);
  }

  if (args.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // テーブル（デフォルト）: 人が読みやすい簡易出力
  console.log(
    [
      "pair\tvariant\twall_p50_ms\twall_p95_ms\tcpu_mean_ms\theap_delta_mean_bytes",
      ...results.map((r) =>
        [
          r.pair,
          r.variant,
          r.wall_ms_p50.toFixed(3),
          r.wall_ms_p95.toFixed(3),
          r.cpu_ms_mean.toFixed(3),
          Math.trunc(r.heap_used_delta_bytes_mean).toString(),
        ].join("\t"),
      ),
    ].join("\n"),
  );

  if (args.writeArtifacts) {
    console.error("wrote: artifacts/bench/bench.json");
  }
}

main();


