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

const tempLogDir = mkdtempSync(path.join(tmpdir(), "avtc-pi-parallel-work-guardrail-test-logs-"));
process.env.PI_LOGGER_DIR = tempLogDir;
