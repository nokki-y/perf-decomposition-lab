import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function parseArgs(argv) {
  const m = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith("--")) {
      m.set(key, v);
      i++;
    } else {
      m.set(key, "true");
    }
  }
  const pair = m.get("pair");
  const variant = m.get("variant");
  const loops = Number(m.get("loops") ?? "2000");
  if (!pair || !variant) throw new Error("required: --pair <pairA|pairB|pairC> --variant <slow|fast>");
  return { pair, variant, loops };
}

// V8 Native Syntax を使うため、起動側で `node --allow-natives-syntax` が必須。
// ここでは存在チェックはできない（構文が特別）ので、エラーは起動側で扱う。

function runHot(fn, input, loops) {
  let out;
  for (let i = 0; i < loops; i++) out = fn(input);
  return out;
}

async function main() {
  const { pair, variant, loops } = parseArgs(process.argv);

  // dist/js から対象関数を読み込む（TSでは %DebugPrint を書けないため、ここは JS で実装）。
  const root = process.cwd();
  const dist = resolve(root, "dist", "js", "pairs");

  let mod;
  if (pair === "pairA") mod = await import(pathToFileURL(resolve(dist, "pairA_hidden_class.js")).href);
  else if (pair === "pairB") mod = await import(pathToFileURL(resolve(dist, "pairB_arrays.js")).href);
  else if (pair === "pairC") mod = await import(pathToFileURL(resolve(dist, "pairC_closures_gc.js")).href);
  else throw new Error(`unknown pair: ${pair}`);

  const fnName = `${pair}_${variant}`;
  const fn = mod[fnName];
  if (typeof fn !== "function") throw new Error(`function not found: ${fnName}`);

  // 観測のための入力は軽量にしつつ、フィードバックが集まる程度の反復は行う。
  const input = (() => {
    if (pair === "pairA") return { n: 200, iters: 2 };
    if (pair === "pairB") return { n: 20_000, iters: 1 };
    if (pair === "pairC") return { n: 800, iters: 1 };
    return { n: 1000, iters: 1 };
  })();

  const out = runHot(fn, input, loops);
  console.log(JSON.stringify({ pair, variant, loops, out }));

  // ここで FeedbackVector（MONOMORPHIC/POLYMORPHIC 等）が出力される。
  // eslint-disable-next-line no-undef
  %DebugPrint(fn);
}

await main();


