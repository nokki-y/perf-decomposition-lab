import test from "node:test";
import assert from "node:assert/strict";

import { pairs } from "../pairs";

test("All pairs: slow and fast return the same result for the same input", () => {
  for (const p of pairs) {
    for (const seed of [1, 2, 3]) {
      const input = p.makeInput(seed);
      const slow = p.slow(input);
      const fast = p.fast(input);
      assert.deepEqual(slow, fast, `${p.id} mismatch at seed=${seed}`);
    }
  }
});


