## 仮説（なぜ “遅い/速い” が起きるか）

このリポジトリの各ペアは「同一結果」を返す一方で、**V8 が集める型フィードバック**や **最適化（TurboFan）/Deopt**、さらに **最適化後コードの形**が変わるように作っています。

---

## Pair A: オブジェクト形状（hidden class / Map）とプロパティアクセス

- **遅い例（pairA_slow）**
  - プロパティの追加/削除、初期化順の揺れで map が揺れる
  - その結果、Load 系の IC が monomorphic を維持しにくくなり、polymorphic 化しやすい
- **速い例（pairA_fast）**
  - 同一のプロパティ集合・初期化順を維持し、map を固定しやすい

**検証**:
- `artifacts/v8-logs/pairA-*.stdout-stderr.txt` の `--print-bytecode` 出力で FeedbackVector を比較
- `--trace-opt/--trace-deopt` で最適化/Deopt を比較

---

## Pair B: 配列処理（packed vs holey、型混在）

- **遅い例（pairB_slow）**
  - 穴あき（sparse write）や型混在で elements kind が劣化しやすい
  - 反復中の分岐・型/穴チェックが増えやすい
- **速い例（pairB_fast）**
  - 数値型の dense array を維持し、直線的なアクセス

**検証**:
- bytecode のフィードバック（KeyedLoad まわり）や `artifacts/asm/*.asm` のループ内を比較

---

## Pair C: クロージャ/割り当て圧（allocation、GC）

- **遅い例（pairC_slow）**
  - ループ内で closures / 小オブジェクトを大量生成 → allocation が増える
  - `--trace-gc` の行数や頻度が増え、bench の heap delta や wall/cpu が悪化しやすい
- **速い例（pairC_fast）**
  - 生成を外へ移動・再利用し、割り当てを減らす

**検証**:
- `artifacts/v8-logs/pairC-*.stdout-stderr.txt` の `--trace-gc`
- `artifacts/bench/bench.json` の `heap_used_delta_bytes_mean` / `cpu_ms_mean`


