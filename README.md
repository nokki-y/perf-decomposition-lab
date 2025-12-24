# perf-decomposition-lab

同じ処理結果を返す TypeScript 実装でも、**生成された JavaScript の形**や **V8 の最適化状態（IC/hidden class / opt・deopt）**、さらに **最適化後コードの（disassemble 相当の）出力**が異なり、その差が **wall-clock time / CPU time / GC / JIT 状態**にどう現れるかを「分解」して理解するための検証リポジトリです。

---

## このリポジトリで “遅い / 速い” とするもの（定義）

同一結果でも、以下が **観測上 “遅くなりがち”** になる書き方を「遅い例」、その逆を「速い例」として扱います（最終的な速さは環境・V8バージョンで変動します。目的は「差の原因を分解して説明できる」ことです）。

- **hidden class（Map）/ オブジェクト形状**: 形状が揺れる（追加/削除や初期化順が揺れる）→ map 遷移が増え、IC が polymorphic/megamorphic 化しやすい
- **inline cache（IC）/ monomorphism**: monomorphic なフィードバックを保てるか（同じ型・同じ map を見続けられるか）
- **deopt**: 型仮定が破れる・穴あき配列・型混在などで deopt が発生しやすい
- **GC 圧（allocation）**: ループ内クロージャ生成や不要オブジェクト生成で割り当てが増え、GC 回数や pause が増える
- **Elements kind（packed vs holey / double vs tagged）**: 配列の穴・型混在で elements kind が劣化しやすい

---

## 成果物（各レイヤー）と観測方法

### レイヤー1: TypeScript → JavaScript（トランスパイル結果）
- **成果物**: `dist/js/**`（`tsc` の出力）
- **観測**:
  - 例: `dist/js/pairs/pairA_hidden_class.js` を `src/pairs/pairA_hidden_class.ts` と見比べる
  - `git diff --no-index src/pairs/pairA_hidden_class.ts dist/js/pairs/pairA_hidden_class.js` のように差分確認

### レイヤー2: JavaScript → V8 観測（opt/deopt, bytecode/feedback）
- **成果物**:
  - `artifacts/v8-logs/*.stdout-stderr.txt`（`--trace-opt/--trace-deopt/--trace-gc` + `--print-bytecode` の出力を集約）
  - `artifacts/v8-logs/*.v8.log`（`--log-ic/--log-maps` 等。機械処理向け）
- **観測（最低限）**:
  - `stdout-stderr.txt` 内で `optimized` / `deopt` を探す（`--trace-opt` / `--trace-deopt`）
  - `--print-bytecode` 出力の **FeedbackVector** を見て、Load/KeyedLoad などが **MONOMORPHIC / POLYMORPHIC** へどう遷移するかを比較する

### レイヤー3: V8 → CPU（機械語/アセンブリ相当）
- **成果物**: `artifacts/asm/*.asm`
  - V8 の `--redirect-code-traces-to` により、deopt 情報と disassembly 相当がファイルに出力されます
- **観測**:
  - “どの関数が最適化されたか” “分岐/呼び出し/境界チェックがどう変わったか” をペア間で比較

---

## 期待される観測差分の例（仮説）と検証

詳しくは `docs/hypotheses.md` を参照してください。例として:

- **Pair A（hidden class）**:
  - 遅い例: map が揺れ、bytecode feedback で **POLYMORPHIC** 化しやすい。trace-deopt が出る場合もある
  - 速い例: map が固定され **MONOMORPHIC** を維持しやすい
  - **検証**: `artifacts/v8-logs/pairA-*.stdout-stderr.txt` の FeedbackVector と opt/deopt を比較

- **Pair B（配列）**:
  - 遅い例: holey / 型混在で elements kind が劣化、境界や型チェックが増えやすい
  - 速い例: packed + 数値型を揃えた連続アクセスで最適化が効きやすい
  - **検証**: bytecode のフィードバックと `artifacts/asm/*.asm` のループ周辺を比較

- **Pair C（クロージャ/GC）**:
  - 遅い例: ループ内でクロージャ/オブジェクトを大量生成し GC 回数/時間が増えやすい
  - 速い例: 生成を減らし GC 圧を下げる
  - **検証**: `--trace-gc` の出力と、bench の `cpu_ms` / `heap_used_delta_bytes` を比較

---

## 実行手順

### Node.js バージョン要件
- **推奨**: Node.js **LTS (v20 以上)**
- **動作確認**: Node v22 系でも動きます（本環境は v22.13.1）

---

## なぜ本リポジトリでは jsvu（d8）を使っていないのか

結論として、このリポジトリの主題は「**V8 単体ベンチ**」ではなく、**Node.js 上で実際に動作する V8 の最適化・実行挙動を、成果物（TS→JS）からログ/asm まで含めて分解して理解すること**にあります。そのため、あえて Node.js を実行環境に固定しています。

### jsvu（d8）とは（何のためのツールか）

`jsvu`（[GoogleChromeLabs/jsvu](https://github.com/GoogleChromeLabs/jsvu)）は、複数バージョンの JavaScript エンジン（例: V8 の `d8`）を手元で管理・実行し、**エンジン単体の挙動差（最適化、IC、GC、バイトコードなど）を素早く比較**するのに向いたツールです。特に「V8 のあるバージョンでのみ起きる現象」を切り分ける用途で強力です。

### Node.js と d8 の実行モデルの違い（観測対象が変わる）

同じ V8 を使っていても、Node.js と `d8` は「エンジンの使い方＝実行モデル」が違います。

- **Node.js**: JS の実行に加えて、起動時の初期化（組み込み/内部スクリプト、スナップショット、フラグ、組み込みクラスやグローバルの構成）、イベントループ、libuv、モジュール解決・ローダ、`require`/ESM、C++ バインディングなどを含む **ランタイム** です。つまり「実務の実行文脈」を含んだ状態で V8 が動きます。
- **d8**: V8 のシェルで、Node 固有のランタイム層を持たず、エンジン機能の検証/デバッグ向けです。**“V8 をそのまま触る”** 代わりに、Node の文脈は基本的に含まれません。

この差は、最適化そのものだけでなく、**ウォームアップのされ方、グローバル環境、組み込み関数/プロトタイプの状態、実行前後のノイズ（初期化コストや割り込み点）**など、計測・観測の前提条件に影響します。

### 本リポジトリが保持したい実行経路（TS→JS→Node→V8→CPU）

このリポジトリでは、実務に近い以下の経路を意図的に維持しています。

- **TypeScript → JavaScript**: 生成物の「形」（プロパティ初期化順、配列操作、ヘルパー/トランスパイルの癖）が V8 のフィードバックや最適化に直結するため
- **JavaScript → Node.js**: 実際にサービスやツールが動く“現場”の実行文脈を前提にしたい（Node の起動・初期化・実行環境の影響を含めたい）ため
- **Node.js → V8 → CPU**: `--trace-opt/--trace-deopt/--print-bytecode` や asm 相当の出力まで繋げて、「なぜ遅い/速いのか」を層別に説明できる状態にしたいため

### jsvu（d8）にすると逆に失われやすい観測軸

`d8` を使うこと自体は良い選択肢ですが、本リポジトリの目的に対しては次の観測軸が薄くなります（＝「V8 だけ綺麗に見る」代わりに「Node 上でどうか」を捨てる）。

- **Node 固有の初期化・実行文脈**: 起動時の初期化や組み込みの状態、ランタイム層を含む前提条件
- **“Node で起きる” 最適化/非最適化の再現性**: Node のフラグやビルド、スナップショット、組み込み関数の実装差が絡むケースの再現
- **実務に近い計測・運用の前提**: 依存関係、ビルド（TS→JS）、実行形態（CLI/スクリプト/サービス寄り）まで含めた一連の手触り

ここでの狙いは「V8 の純粋な性能を測る」ではなく、「**Node.js 上で**この書き方がどのようにフィードバックを作り、どこで最適化され/外れ、最終的に CPU 命令列がどう変わるか」を観測することです。

### 将来的に jsvu（d8）を使うなら（補足）

このリポジトリでも、次のフェーズでは `jsvu`/`d8` の導入価値があります。

- **現象の最小再現**: Node 上で見えた差を、ランタイム要因を剥がしながら “V8 単体” の性質として切り出す
- **バージョン差分の追跡**: 「V8 の特定バージョンで変わった」ことを素早く確認する（回帰/改善の確認）
- **エンジン機能の局所検証**: 特定の IC/Bytecode/最適化パスを狙った検証を、より薄い環境で行う

つまり、**Node で現象を掴む → d8 でエンジン要因に還元する**、という役割分担が自然です。本リポジトリはその前半（Node 上での分解観測）に重心を置いています。

### セットアップ（npm に統一）

```bash
cd /Users/yoshihide-unoki/dev/perf-decomposition-lab
npm install
```

### 1) TypeScript → JavaScript を生成（dist/js）

```bash
npm run build
```

生成物:
- `dist/js/**`

### 2) 同一入力・同一出力の担保（テスト）

```bash
npm test
```

### 3) ベンチ（warm-up + 計測）

```bash
npm run bench
```

生成物:
- `artifacts/bench/bench.json`

最低限の読み方:
- **wall_ms**: 実時間（ユーザー体感に近い）
- **cpu_ms**: CPU 使用時間（OSスケジューリングや待ちの影響を受けにくい）
- **heap_used_delta_bytes**: 計測区間前後のヒープ使用量差分（GC圧の指標の一つ）

### 4) V8 ログ + bytecode + asm 生成（分解観測の主役）

```bash
npm run artifacts:v8
```

生成物（ペア×遅い/速い）:
- `artifacts/v8-logs/<pair>-<variant>.stdout-stderr.txt`
- `artifacts/v8-logs/<pair>-<variant>.v8.log`
- `artifacts/asm/<pair>-<variant>.asm`

最低限の読み方:
- `stdout-stderr.txt`:
  - `trace-opt`/`trace-deopt` 行で **最適化/Deopt の有無と理由**を見る
  - `--print-bytecode` の **FeedbackVector** セクションで monomorphic/polymorphic の遷移を見る
- `asm/*.asm`:
  - ループの内側で **境界チェック・型チェック・分岐**が増えていないか
  - 関数呼び出しが **inlined** されている/いない などを比較

---

## ディレクトリ構成

- `src/pairs/*`: 遅い/速い TS 実装（必須 3 ペア）
- `src/harness/*`: ベンチ共通ハーネス（warm-up/計測/集計）
- `src/tests/*`: 同一出力のテスト
- `dist/js/*`: `tsc` 出力（TypeScript → JavaScript）
- `artifacts/*`: V8 ログ・asm・ベンチ結果
- `docs/*`: 仮説とログの読み方

