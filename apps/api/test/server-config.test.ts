import assert from "node:assert/strict";
import test from "node:test";
import { getWorkerOptions, parsePositiveInterval, parseWorkerIntervals } from "../src/server.js";

test("worker options use the documented defaults when intervals are unset", () => {
  assert.deepEqual(getWorkerOptions({}), {
    scheduler: { enabled: true, intervalMs: undefined },
    executionQueue: { enabled: true, intervalMs: undefined },
    reconciliation: { enabled: true, intervalMs: undefined },
  });
});

test("worker intervals are passed through from environment values", () => {
  assert.deepEqual(
    getWorkerOptions({
      RECONCILIATION_INTERVAL_MS: "45000",
      EXECUTION_QUEUE_INTERVAL_MS: "15000",
      SCHEDULER_INTERVAL_MS: "120000",
    }),
    {
      scheduler: { enabled: true, intervalMs: 120000 },
      executionQueue: { enabled: true, intervalMs: 15000 },
      reconciliation: { enabled: true, intervalMs: 45000 },
    },
  );
});

test("invalid worker intervals fail fast with the variable name", () => {
  for (const [name, value] of [
    ["RECONCILIATION_INTERVAL_MS", "not-a-number"],
    ["EXECUTION_QUEUE_INTERVAL_MS", "0"],
    ["SCHEDULER_INTERVAL_MS", "-1"],
    ["RECONCILIATION_INTERVAL_MS", ""],
  ] as const) {
    assert.throws(
      () => parsePositiveInterval(name, value),
      new RegExp(`${name} must be a positive integer`),
    );
  }
});

test("all worker interval environment variables are parsed together", () => {
  assert.deepEqual(
    parseWorkerIntervals({
      RECONCILIATION_INTERVAL_MS: "1",
      EXECUTION_QUEUE_INTERVAL_MS: "2",
      SCHEDULER_INTERVAL_MS: "3",
    }),
    { reconciliation: 1, executionQueue: 2, scheduler: 3 },
  );
});
