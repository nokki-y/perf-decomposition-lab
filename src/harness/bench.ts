import { performance } from "node:perf_hooks";
import * as v8 from "node:v8";

import { mean, quantile } from "./stats";

export type BenchOptions = {
  warmupIterations: number;
  measureIterations: number;
  repeats: number;
  seed: number;
};

export type BenchSample = {
  wall_ms: number;
  cpu_ms: number;
  heap_used_delta_bytes: number;
  elu_utilization?: number;
};

export type BenchSummary = {
  samples: BenchSample[];
  wall_ms_p50: number;
  wall_ms_p95: number;
  wall_ms_mean: number;
  cpu_ms_mean: number;
  heap_used_delta_bytes_mean: number;
};

function hrNowNs(): bigint {
  return process.hrtime.bigint();
}

function cpuNow(): NodeJS.CpuUsage {
  return process.cpuUsage();
}

function cpuDiffMs(a: NodeJS.CpuUsage, b: NodeJS.CpuUsage): number {
  const du = b.user - a.user;
  const ds = b.system - a.system;
  return (du + ds) / 1000;
}

function maybeGc(): void {
  // `node --expose-gc` が必要
  if (typeof global.gc === "function") global.gc();
}

export function runBench<I, O>(
  fn: (input: I) => O,
  input: I,
  opts: BenchOptions,
): BenchSummary {
  // ウォームアップ: 実行時最適化（段階的な最適化移行）を促す。
  for (let i = 0; i < opts.warmupIterations; i++) fn(input);

  const samples: BenchSample[] = [];
  for (let r = 0; r < opts.repeats; r++) {
    maybeGc();

    const heapBefore = process.memoryUsage().heapUsed;
    const eluBefore = performance.eventLoopUtilization();

    const cpuBefore = cpuNow();
    const t0 = hrNowNs();
    for (let i = 0; i < opts.measureIterations; i++) fn(input);
    const t1 = hrNowNs();
    const cpuAfter = cpuNow();

    const eluAfter = performance.eventLoopUtilization(eluBefore);
    const heapAfter = process.memoryUsage().heapUsed;

    const wallMs = Number(t1 - t0) / 1e6;
    const cpuMs = cpuDiffMs(cpuBefore, cpuAfter);
    const heapDelta = heapAfter - heapBefore;

    samples.push({
      wall_ms: wallMs,
      cpu_ms: cpuMs,
      heap_used_delta_bytes: heapDelta,
      elu_utilization: eluAfter.utilization,
    });
  }

  const wall = samples.map((s) => s.wall_ms);
  const cpu = samples.map((s) => s.cpu_ms);
  const heap = samples.map((s) => s.heap_used_delta_bytes);

  return {
    samples,
    wall_ms_p50: quantile(wall, 0.5),
    wall_ms_p95: quantile(wall, 0.95),
    wall_ms_mean: mean(wall),
    cpu_ms_mean: mean(cpu),
    heap_used_delta_bytes_mean: mean(heap),
  };
}

export function v8EnvSummary(): Record<string, unknown> {
  return {
    node: process.version,
    v8: process.versions.v8,
    arch: process.arch,
    platform: process.platform,
    heap: v8.getHeapStatistics(),
  };
}


