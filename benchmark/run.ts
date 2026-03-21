/**
 * Performance benchmark: TypeScript vs Rust mdx-formatter
 *
 * Compares wall-clock time for both formatters across varying input sizes.
 * Uses median timing for stable results and reports cold-start vs warm performance.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { format as tsFormat } from '../src/index.js';
import { format as rustFormat, isRustFormatterAvailable } from '../src/rust-formatter.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ITERATIONS = 100;
const WARMUP_ITERATIONS = 5;
const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const FIXTURE_FILES = ['small.mdx', 'medium.mdx', 'large.mdx'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function percentile(sorted: number[], pct: number): string {
  return sorted[Math.min(Math.floor(sorted.length * pct), sorted.length - 1)].toFixed(2);
}

interface FixtureInfo {
  name: string;
  content: string;
  lines: number;
  bytes: number;
}

interface BenchResult {
  coldMs: number;
  warmMedianMs: number;
  warmTimings: number[];
}

// ---------------------------------------------------------------------------
// Benchmark runners
// ---------------------------------------------------------------------------

async function benchmarkTs(content: string): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await tsFormat(content);
  }

  // Single-call latency (first timed call after warmup)
  const coldStart = performance.now();
  await tsFormat(content);
  const coldMs = performance.now() - coldStart;

  // Warm runs
  const timings: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await tsFormat(content);
    timings.push(performance.now() - start);
  }

  return { coldMs, warmMedianMs: median(timings), warmTimings: timings };
}

async function benchmarkRust(content: string): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await rustFormat(content);
  }

  // Single-call latency
  const coldStart = performance.now();
  await rustFormat(content);
  const coldMs = performance.now() - coldStart;

  // Warm runs
  const timings: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await rustFormat(content);
    timings.push(performance.now() - start);
  }

  return { coldMs, warmMedianMs: median(timings), warmTimings: timings };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rustAvailable = isRustFormatterAvailable();

  console.log('=== mdx-formatter Performance Benchmark ===\n');

  // Load fixtures
  const fixtures: FixtureInfo[] = FIXTURE_FILES.map((file) => {
    const content = readFileSync(join(FIXTURE_DIR, file), 'utf-8');
    return {
      name: file,
      content,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf-8'),
    };
  });

  console.log('Inputs:');
  for (const f of fixtures) {
    console.log(`  ${padRight(f.name + ':', 14)} ${f.lines} lines, ${formatBytes(f.bytes)}`);
  }

  if (!rustAvailable) {
    console.log('\n⚠  Rust formatter not available — skipping Rust benchmarks.');
    console.log('   Build with: pnpm build:rust\n');
  }

  console.log(`\nConfig: ${ITERATIONS} iterations, ${WARMUP_ITERATIONS} warmup, median timing\n`);

  // Run benchmarks
  const results: {
    name: string;
    ts: BenchResult;
    rust: BenchResult | null;
  }[] = [];

  for (const fixture of fixtures) {
    process.stdout.write(`Benchmarking ${fixture.name}...`);

    const ts = await benchmarkTs(fixture.content);
    let rust: BenchResult | null = null;

    if (rustAvailable) {
      rust = await benchmarkRust(fixture.content);
    }

    results.push({ name: fixture.name, ts, rust });
    console.log(' done');
  }

  // ---------------------------------------------------------------------------
  // Print results table — warm (median)
  // ---------------------------------------------------------------------------

  console.log(`\nResults (${ITERATIONS} iterations, median):\n`);

  if (rustAvailable) {
    console.log('| Input      | TS (ms)  | Rust (ms) | Speedup |');
    console.log('|------------|----------|-----------|---------|');
    for (const r of results) {
      const tsMs = r.ts.warmMedianMs.toFixed(2);
      const rustMs = r.rust!.warmMedianMs.toFixed(2);
      const speedup = (r.ts.warmMedianMs / r.rust!.warmMedianMs).toFixed(1) + 'x';
      console.log(
        `| ${padRight(r.name, 10)} | ${padLeft(tsMs, 8)} | ${padLeft(rustMs, 9)} | ${padLeft(speedup, 7)} |`,
      );
    }
  } else {
    console.log('| Input      | TS (ms)  |');
    console.log('|------------|----------|');
    for (const r of results) {
      const tsMs = r.ts.warmMedianMs.toFixed(2);
      console.log(`| ${padRight(r.name, 10)} | ${padLeft(tsMs, 8)} |`);
    }
  }

  // ---------------------------------------------------------------------------
  // Print cold-start table
  // ---------------------------------------------------------------------------

  console.log('\nSingle-call latency (first timed call):\n');

  if (rustAvailable) {
    console.log('| Input      | TS (ms)  | Rust (ms) | Speedup |');
    console.log('|------------|----------|-----------|---------|');
    for (const r of results) {
      const tsMs = r.ts.coldMs.toFixed(2);
      const rustMs = r.rust!.coldMs.toFixed(2);
      const speedup = (r.ts.coldMs / r.rust!.coldMs).toFixed(1) + 'x';
      console.log(
        `| ${padRight(r.name, 10)} | ${padLeft(tsMs, 8)} | ${padLeft(rustMs, 9)} | ${padLeft(speedup, 7)} |`,
      );
    }
  } else {
    console.log('| Input      | TS (ms)  |');
    console.log('|------------|----------|');
    for (const r of results) {
      const tsMs = r.ts.coldMs.toFixed(2);
      console.log(`| ${padRight(r.name, 10)} | ${padLeft(tsMs, 8)} |`);
    }
  }

  // ---------------------------------------------------------------------------
  // Print p5 / p95
  // ---------------------------------------------------------------------------

  console.log('\nPercentiles (warm runs):\n');

  if (rustAvailable) {
    console.log('| Input      | TS p5 (ms) | TS p95 (ms) | Rust p5 (ms) | Rust p95 (ms) |');
    console.log('|------------|------------|-------------|--------------|---------------|');
    for (const r of results) {
      const tsSorted = [...r.ts.warmTimings].sort((a, b) => a - b);
      const rustSorted = [...r.rust!.warmTimings].sort((a, b) => a - b);
      console.log(
        `| ${padRight(r.name, 10)} | ${padLeft(percentile(tsSorted, 0.05), 10)} | ${padLeft(percentile(tsSorted, 0.95), 11)} | ${padLeft(percentile(rustSorted, 0.05), 12)} | ${padLeft(percentile(rustSorted, 0.95), 13)} |`,
      );
    }
  } else {
    console.log('| Input      | TS p5 (ms) | TS p95 (ms) |');
    console.log('|------------|------------|-------------|');
    for (const r of results) {
      const tsSorted = [...r.ts.warmTimings].sort((a, b) => a - b);
      console.log(
        `| ${padRight(r.name, 10)} | ${padLeft(percentile(tsSorted, 0.05), 10)} | ${padLeft(percentile(tsSorted, 0.95), 11)} |`,
      );
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
