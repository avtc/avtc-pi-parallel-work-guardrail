// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for pi-parallel-work-guardrail schema invariants the guardrail's logic depends on.
 *
 * Value accept/reject, defaults, and env-var serialization are the settings-ui engine's job
 * (covered in settings-ui's own tests). Here we guard only the consumer-owned invariant the
 * preset builder relies on: GUARDRAIL_MODE_VALUES and GUARDRAIL_MODE_LABELS must align one-to-one
 * (the schema builds presets via `.map((value, i) => [LABELS[i], value])`).
 */

import { describe, expect, it } from "vitest";
import { GUARDRAIL_MODE_LABELS, GUARDRAIL_MODE_VALUES } from "../src/schema.js";

describe("parallelWorkGuardrail schema invariants", () => {
  it("GUARDRAIL_MODE_VALUES aligns one-to-one with GUARDRAIL_MODE_LABELS", () => {
    expect(GUARDRAIL_MODE_VALUES).toHaveLength(GUARDRAIL_MODE_LABELS.length);
  });
});
