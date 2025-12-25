# 学習ノート：実行レイヤー分解の詳細（根拠: `perf-decomposition-lab`）

前段ノートでは「指標（Execution Time / Active CPU / CPU Throttle / p75・p95）をどう読むか」と「なぜそれが起きるか（因果の全体像）」を扱い、**実行レイヤー分解の詳細は別ノートにまとめる**とした。
この `learning-note.md` が、その「別ノート」に該当する。

実行レイヤーの観測・根拠は Public な実験リポジトリ **[`nokki-y/perf-decomposition-lab`](https://github.com/nokki-y/perf-decomposition-lab)** を参照する。

## 状況

### 負荷試験の実施背景

- BRIDGE_DOC において全体帳票の負荷試験を実施した。
- 帳票生成は PDF 出力を伴い、`node-canvas` 等を利用する **CPU / メモリ負荷の高い処理**を含む。

### 技術スタック

- フロントエンド / BFF：Next.js
- 実装言語：TypeScript
- 実行環境：Vercel（Serverless Functions）
- データストア / 周辺基盤：Supabase

### 試験条件

- implementation：10,000件
- event template：1件
- individual template：1件

### 当初の評価状況

- PDF 出力のトータル処理時間自体は要件をクリアしていた。
- しかし、以下の点を説明・判断できる状態ではなかった。
  - なぜ今回この条件で要件を満たせたのか
  - 本当に性能的な余裕があるのか
  - 詳細に見たときに改善の余地がないのか

### 次のアクションの必要性

- そのため、Vercel / Supabase のダッシュボードから以下の評価指標を確認し、性能を定量的に理解しようとしていた。
  - Execution Time
  - Active CPU
  - CPU Throttle
  - p75 / p95

## トラブル

### 指標理解の不足（前段で定義は理解したが、内部像がない）

- Active CPU / CPU Throttle / p75・p95 の言葉は理解できても、内部で「何が起きているか」をイメージできなかった。
- 特に “CPU Throttle で処理が止まる” を、TS/JS の行単位で誤解していた。

### コードレベルでの誤解

- for ループの途中で止まる、特定行が実行されなくなる、のように捉えてしまう。
- しかし CPU は TS/JS を直接実行せず、**CPU が実行しているのは常にマシンコード**である。

### 未解消だった疑問

- どの単位（CPU / スケジューラ / 実行時間枠）で止まっているのか
- それがアプリケーションの遅延としてどう表出するのか

この疑問に答えるには、TS/JS と CPU の間の「実行レイヤー」を言語化する必要があった。

## アクション

### 1) “クラウド固有”の決め打ちをやめ、実行レイヤーの理解に寄せた

- 「クラウドが遅い/スロットリングが悪い」と決め打ちせず、
  **“TypeScript が最終的にどの形のコードとして CPU 上で実行されているか” を説明できていない**ことを問題の中心に置いた。
- そのために、TS/JS の静的生成物だけでなく、V8 が実行中に生成する成果物（bytecode / 最適化後コード / deopt 情報）を **観測できる形**にする必要があった。

### 2) TS/JS と CPU の間を「生成物」で分解した（本ノートの核）

TypeScript の実行を「コード」ではなく「生成されるもの」で分解すると、次になる。

- **TypeScript（固定）**
  - 人が書くソース。CPU が直接実行するものではない。
- **JavaScript（固定）**
  - `tsc` の生成物。ファイルとして固定される（比較・差分が取れる）。
- **V8 Bytecode（流体）**
  - V8 が実行時に生成する中間表現。Ignition が解釈・実行する。
  - 生成物は通常メモリ内で、状況に応じて作られ/捨てられ/置換される。
- **最適化後マシンコード（流体）**
  - V8 が JIT（TurboFan 等）で生成する CPU 命令列。
  - 「観測した型・形状」を前提とするため、前提が崩れると **deopt**（最適化解除）で置換され得る。

この「固定（ts/js）」と「流体（v8 内部生成物）」の区別が、本ノートの主題。

### 3) “流体の生成物”を観測できるようにした（実験リポジトリ）

`perf-decomposition-lab` は「結果が同じなのに遅い」を作る **Pair A/B/C** を持ち、観測用スクリプトで成果物を残す。

- **ベンチ（数値）**: `artifacts/bench/bench.json`
  - wall（実時間）/ cpu（CPU使用時間）/ heap delta（割り当て圧の一指標）
- **opt/deopt/GC/bytecode（人が読む）**: `artifacts/v8-logs/*.stdout-stderr.txt`
- **FeedbackVector（確実に MONO/POLY を見る）**: `artifacts/v8-logs/*.debugprint.txt`
- **最適化後コード（逆アセンブル相当）**: `artifacts/asm/*.asm`

補足：`%DebugPrint` は TypeScript から直接書きづらいため、`perf-decomposition-lab/scripts/debugprint.mjs` が `node --allow-natives-syntax` で実行される（危険な native 構文を “観測の最小限” だけ使う）。

### 4) “同一結果でも遅い”を、3 つの典型パターンで固定化した（Pair A/B/C）

#### Pair A（hidden class / Map）

- slow: 形状（Map）を揺らす（初期化順の揺れ、追加/削除）
- fast: 形状（Map）を固定しやすくする（同順初期化、増減しない、再利用）

ここでの “遅さ” は、`o.a` という行の遅さではなく、**同じアクセスサイトが複数 Map を観測して最適化が成立しづらい（または汎用化する）**こととして説明できる。

#### Pair B（配列 / elements kind / deopt）

- slow: 穴あき（holes）＋型混在を作る
- fast: 密な数値配列を維持する

ここでの “遅さ” は、`arr[i]` が遅いというより、**elements kind / map の前提が崩れて deopt し得る**こととして説明できる（例：`wrong map`）。

#### Pair C（クロージャ / allocation / GC）

- slow: ホットループ内でクロージャ＋キャプチャ用オブジェクトを大量生成
- fast: 生成を外へ逃がし、再利用して割り当てを減らす

ここでの “遅さ” は、関数呼び出し行そのものではなく、**割り当て圧→GC、many closures、呼び出し多相化**の複合として説明できる。

### 5) Vercel の指標へ読み替える（このノートの出口）

- **Active CPU**: “CPU work が増える要因”があると上がる（GC、deopt、チェック増、汎用化、最適化不成立など）
- **CPU Throttle**: “CPU が必要な処理”ほど影響を受け、同じ work でも wall が伸びる（= 体感が悪化する）
- **p95**: 入力揺れ、cold start、deopt、GC など「揺れるケース」が露出しやすい

結局、指標だけを見るのではなく「その指標を作る実行状態（生成物）がどうなっているか」を疑えることが重要になる。

関連: `perf-decomposition-lab` が「Node 上の文脈」を保持して観測する理由も、この読み替えを成立させるため。

## ゴール

### 本ノートの到達点

- “処理が止まる/遅くなる” を、コード行ではなく **実行レイヤー（JIT/deopt/IC/GC）**として説明できるようになった。
- TS/JS は固定だが、V8 が生成する bytecode / 最適化後マシンコードは **流体で置換される**、という構造を言語化できるようになった。
- 「要件を満たせた/余裕がある/改善余地がある」を、次の問いで切れるようになった。
  - どの前提（型/形状/elements kind）が成立して最適化が効いたか？
  - その前提は p95 の条件（cold start・入力揺れ・負荷）でも成立するか？
  - 崩れるなら、崩れているレイヤーはどこか（IC/Map、elements kind、allocation/GC、など）？

## エピローグ

### まとめ

- V8 は単に “JS を速くする箱” ではなく、**観測した型・形状を前提にコードを生成し、前提が崩れれば解除し、必要なら作り直す**実行エンジンだと整理できた。
- “固定的なコード（ts/js）” と “流体的なコード（v8 内部生成物）” を切り分けることで、Serverless の CPU 指標（Active CPU / Throttle）を **生成物の帰結**として語れるようになった。

### 今後の深掘り

- FeedbackVector / Inline Cache が最適化判断に与える影響（MONO→POLY の遷移）
- deopt の具体的条件と、その実行コスト（どの reason が何を意味するか）
- Serverless の CPU 制御（Throttle）と、短時間実行における “最適化が成立しない” 問題の関係

関連ドキュメント（実験リポジトリ内）:
- `docs/hypotheses.md`（各ペアの仮説）
- `docs/how-to-read-v8-logs.md`（ログの読み方）
- `scripts/run-v8.mjs`（観測用スクリプト）


