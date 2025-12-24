import { mkdirSync, rmSync, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * このスクリプトの役割
 * --------------------
 * 各ペア（pairA/pairB/pairC）について、slow/fast を **Node を複数の V8 フラグ付きで起動**して実行し、
 * 「TypeScript/JavaScript の上にある V8 実行レイヤの差分」を観測できる成果物を artifacts/ に保存します。
 *
 * 生成する成果物（ペア×slow/fast）
 * - artifacts/v8-logs/<pair>-<variant>.stdout-stderr.txt
 *   - `--trace-opt/--trace-deopt/--trace-gc` などの “人が読む” ログ（標準出力/標準エラー）
 *   - `--print-bytecode` による bytecode 出力（ただし V8 版によっては MONO/POLY 表記が出ない場合あり）
 *
 * - artifacts/v8-logs/<pair>-<variant>.v8.log
 *   - `--log-ic/--log-maps/--log-code` などの “ツール向け” ログ（v8.log 系の専用形式）
 *
 * - artifacts/v8-logs/<pair>-<variant>.debugprint.txt
 *   - `%DebugPrint`（V8 Native Syntax）で関数の FeedbackVector を確実に出すログ
 *   - `LoadProperty MONOMORPHIC` / `... POLYMORPHIC` 等がここに出る（重要）
 *
 * - artifacts/asm/<pair>-<variant>.asm
 *   - `--print-opt-code` による最適化後コードの逆アセンブル相当出力（標準出力）
 *   - `--redirect-code-traces-to` によりファイルへ集約（ベストエフォート）
 *
 * なぜ「同じ処理を3回」実行するのか
 * - 1回の Node 実行で全部出そうとすると、標準出力が巨大になって読みづらくなりやすい
 * - とくに `--print-opt-code` は出力量が大きいので、逆アセンブルは別実行でファイルに集中させる
 * - FeedbackVector は `--print-bytecode` だけでは表記が安定しないことがあるため、
 *   `%DebugPrint` を使う別実行で「確実に MONO/POLY を出す」ようにする
 */
const root = process.cwd();
// 共通 CLI（dist/js/cli.js）: hot 実行で対象ペアの関数を大量に呼び出し、最適化が起きる状況を作る
const cliPath = resolve(join(root, "dist", "js", "cli.js"));
// FeedbackVector を確実に出すための補助スクリプト（V8 Native Syntax を使うので別ファイル）
const debugprintPath = resolve(join(root, "scripts", "debugprint.mjs"));

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function resetFile(p) {
  // 既存ファイルがあれば削除して「今回の実行結果だけ」が残るようにする
  rmSync(p, { force: true });
}

function runOne({ pair, variant, loops }) {
  const base = `${pair}-${variant}`;
  // 観測ログの出力先
  const v8LogsDir = resolve(join(root, "artifacts", "v8-logs"));
  // 逆アセンブル相当（機械語）出力先
  const asmDir = resolve(join(root, "artifacts", "asm"));
  ensureDir(v8LogsDir);
  ensureDir(asmDir);

  // (1) trace / bytecode など “人が読む” ログ
  const traceOut = resolve(join(v8LogsDir, `${base}.stdout-stderr.txt`));
  // (2) v8.log 系 “ツール向け” ログ（IC/map/code 等）
  const v8log = resolve(join(v8LogsDir, `${base}.v8.log`));
  // (3) 逆アセンブル相当の出力
  const asmOut = resolve(join(asmDir, `${base}.asm`));
  // (4) FeedbackVector（MONO/POLY）を確実に出す debugprint
  const debugOut = resolve(join(v8LogsDir, `${base}.debugprint.txt`));

  resetFile(traceOut);
  resetFile(v8log);
  resetFile(asmOut);
  resetFile(debugOut);

  // `--print-bytecode-filter` / `--print-opt-code-filter` 用。
  // dist/js 内の関数名（pairA_fast 等）にマッチさせて、不要な関数の出力を避ける。
  const filter = `${pair}_*`;

  const nodeArgsLogs = [
    /**
     * トレース（標準出力/標準エラーへ出る）
     * - trace-opt: いつ最適化されたか（TurboFan に行ったか）
     * - trace-deopt: 最適化解除（deopt）が起きたか、理由は何か
     * - trace-gc: GC がいつ走ったか（割り当て圧の影響を見る）
     */
    "--trace-opt",
    "--trace-deopt",
    "--trace-gc",
    "--trace-file-names",

    /**
     * bytecode 出力（標準出力へ出る）
     * - `--print-bytecode` は Ignition の bytecode を出す
     * - V8/Node の版によっては、ここに FeedbackVector の MONO/POLY 表記が出ないことがある
     *   → その場合は debugprint（.debugprint.txt）を見る
     */
    "--print-bytecode",
    `--print-bytecode-filter=${filter}`,

    /**
     * ツール処理向けログ（v8.log 系の専用形式）
     * - log-ic: IC（Inline Cache）まわりのイベント
     * - log-maps(+details): Map（hidden class）生成・遷移など
     * - log-code: JIT 生成コードのイベント
     *
     * 注意:
     * - `--logfile-per-isolate` が有効だと isolate-... というファイル名が増えるので、
     *   ここでは `--no-logfile-per-isolate` で “このペアの1ファイル” に揃える。
     */
    "--no-logfile-per-isolate",
    "--log-code",
    "--log-ic",
    "--log-maps",
    "--log-maps-details",
    `--logfile=${v8log}`,

    cliPath,
    "hot",
    "--pair",
    pair,
    "--variant",
    variant,
    "--loops",
    String(loops),
    "--seed",
    "1"
  ];

  // traceOut へ stdout/stderr をまとめてリダイレクトする（spawnSync の stdio で同一 FD を指定）
  const fd = openSync(traceOut, "w");
  const res = spawnSync(process.execPath, nodeArgsLogs, {
    cwd: root,
    stdio: ["ignore", fd, fd]
  });
  closeSync(fd);

  if (res.status !== 0) {
    throw new Error(`v8 run failed: ${base} (exit=${res.status})`);
  }

  /**
   * (別実行) 逆アセンブル相当の出力
   * - `--print-opt-code` は出力量が大きいので、ここは “asm ファイルに集中” させる
   * - `--redirect-code-traces-to` は、deopt 情報と disassembly 相当をファイルに出す（ベストエフォート）
   */
  const nodeArgsAsm = [
    "--print-opt-code",
    `--print-opt-code-filter=${filter}`,
    "--code-comments",
    // 最適化解除情報 + 逆アセンブル相当をファイルへ出す（ベストエフォート）。
    `--redirect-code-traces-to=${asmOut}`,
    cliPath,
    "hot",
    "--pair",
    pair,
    "--variant",
    variant,
    "--loops",
    String(loops),
    "--seed",
    "1"
  ];

  // asmOut に stdout/stderr をまとめて書き込む（逆アセンブル出力が主）
  const asmFd = openSync(asmOut, "w");
  const asmRes = spawnSync(process.execPath, nodeArgsAsm, {
    cwd: root,
    stdio: ["ignore", asmFd, asmFd]
  });
  closeSync(asmFd);

  if (asmRes.status !== 0) {
    throw new Error(`asm run failed: ${base} (exit=${asmRes.status})`);
  }

  /**
   * (別実行) FeedbackVector を確実に出す
   * - `--print-bytecode` だけでは MONOMORPHIC/POLYMORPHIC 表記が出ない場合がある
   * - そこで V8 Native Syntax（%DebugPrint）を使い、関数の FeedbackVector をダンプする
   *
   * 注意:
   * - V8 Native Syntax は危険な機能も含むので、ここでは %DebugPrint のみに限定して利用している
   * - Node 起動に `--allow-natives-syntax` が必須
   */
  const nodeArgsDebug = [
    "--allow-natives-syntax",
    debugprintPath,
    "--pair",
    pair,
    "--variant",
    variant,
    "--loops",
    String(loops)
  ];

  // debugOut に stdout/stderr をまとめて書き込む（FeedbackVector がここに出る）
  const dbgFd = openSync(debugOut, "w");
  const dbgRes = spawnSync(process.execPath, nodeArgsDebug, {
    cwd: root,
    stdio: ["ignore", dbgFd, dbgFd]
  });
  closeSync(dbgFd);

  if (dbgRes.status !== 0) {
    throw new Error(`debugprint run failed: ${base} (exit=${dbgRes.status})`);
  }
}

const matrix = [
  /**
   * 実行回数（loops）の目安:
   * - 目的は “長時間のベンチ” ではなく、JIT の最適化が起きるだけの呼び出し回数を確保すること
   * - loops を大きくしすぎるとログが巨大になり、生成も遅くなる
   * - input は cli 側で「観測用に軽量化」している（bench の input とは別）
   */
  { pair: "pairA", loops: 2_000 },
  { pair: "pairB", loops: 2_000 },
  { pair: "pairC", loops: 2_000 }
];

for (const { pair, loops } of matrix) {
  for (const variant of ["slow", "fast"]) {
    // ここでペア×バリアントごとに runOne を実行し、成果物ファイルを更新する
    console.log(`run: ${pair} ${variant}`);
    runOne({ pair, variant, loops });
  }
}

console.log("done: artifacts/v8-logs, artifacts/asm");


