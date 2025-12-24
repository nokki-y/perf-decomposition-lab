## V8 観測ログの最低限の読み方

このリポジトリでは、V8 の観測を **2 系統**で保存します。

- `artifacts/v8-logs/*.stdout-stderr.txt`
  - 人間が読む用（`--trace-opt/--trace-deopt/--trace-gc/--print-bytecode/--print-opt-code`）
- `artifacts/v8-logs/*.debugprint.txt`
  - 人間が読む用（`node --allow-natives-syntax` + `%DebugPrint` による出力。FeedbackVector の状態が見える）
- `artifacts/v8-logs/*.v8.log`
  - ツール処理向け（`--log-ic/--log-maps/--log-code`）

---

## 1) opt / deopt（最適化・最適化解除）

対象: `*.stdout-stderr.txt`

- **最適化（opt）を探す**:
  - `--trace-opt` の出力で `optimized` に相当する行を探します
- **deopt を探す**:
  - `--trace-deopt` の出力で `deopt` と reason を探します

ポイント:
- 遅い例だけ deopt が多い、または早期に deopt しているなら「仮定が破れやすい」ことの根拠になります。

---

## 2) IC / monomorphic / polymorphic（フィードバック）

対象: `*.debugprint.txt`（推奨） / `*.stdout-stderr.txt`（補助）

`--print-bytecode` は関数の bytecode を出しますが、V8/Node のバージョンによっては
**MONOMORPHIC/POLYMORPHIC 等の表記が stdout に出ない**ことがあります。
その場合、このリポジトリでは `%DebugPrint` による `*.debugprint.txt` を主に参照します。

見る場所:
- `feedback vector:` から始まるブロック
- `LoadProperty MONOMORPHIC` / `LoadProperty POLYMORPHIC` 等の表示

ポイント:
- Pair A/B では特に、遅い例の方が polymorphic 化しやすい（＝同じ site で複数 map/type を見ている）という差が出やすいです。

---

## 3) CPU（disassembly 相当）

対象: `artifacts/asm/*.asm`

これは `--redirect-code-traces-to` による出力で、最適化後コードの disassembly と deopt 情報が混じります。

最低限見る観点:
- ループ内で **分岐**が増えていないか
- **境界チェック**や **型チェック**が残っていないか
- 同じ処理でも、速い例では inlined/簡約されているか


