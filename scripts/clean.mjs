import { rmSync } from "node:fs";

function rm(path) {
  rmSync(path, { recursive: true, force: true });
}

rm("dist");
rm("artifacts");

console.log("cleaned: dist/, artifacts/");


