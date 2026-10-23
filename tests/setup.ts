// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Global vitest setup for avtc-pi-parallel-work-guardrail.
 *
 * Redirects the shared avtc-pi-logger file sink to a per-run temp directory so tests never
 * pollute the real `~/.pi/logs/avtc-pi-parallel-work-guardrail/`. The real `log` singleton reads
 * `PI_LOGGER_DIR` at first import (precedence: explicit options > env > default), so setting
 * it here before any module under test is imported routes every `moduleLog` write to a temp dir.
 *
 * Per-file `vi.mock("../src/log.js", ...)` (see tests/helpers/mock-logger.ts) is still available
 * for tests that need to assert on log *calls* rather than just silence file output.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The logger resolves PI_LOGGER_DIR ONCE at module load (createLogger caches the writer's
// baseDir), and isolate:false shares that module across every file in this worker — a
// per-FILE dir would be silently ignored by files 2+ (their log writes recreate file 1's
// dir even after its cleanup). So: ONE dir per worker. The first setup run creates it and
// later runs reuse it; the per-worker dirs (workers are killed without a clean exit, so
// no in-worker hook is reliable) are swept by prefix in the globalSetup registered in
// vitest.config.ts.
type WorkerWithLogDir = typeof process & { __guardrailTestLogDir?: string };
const worker = process as WorkerWithLogDir;
let tempLogDir = worker.__guardrailTestLogDir;
if (tempLogDir === undefined) {
  tempLogDir = mkdtempSync(path.join(tmpdir(), "avtc-pi-parallel-work-guardrail-test-logs-"));
  worker.__guardrailTestLogDir = tempLogDir;
}
process.env.PI_LOGGER_DIR = tempLogDir;
