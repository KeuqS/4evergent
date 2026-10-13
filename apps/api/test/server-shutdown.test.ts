import assert from "node:assert/strict";
import test from "node:test";
import {
  createShutdownHandler,
  installShutdownHandlers,
  type ShutdownServer,
} from "../src/server.js";

type Timer = ReturnType<typeof setTimeout>;

function testRuntime() {
  const exits: number[] = [];
  const timers: Array<() => void> = [];
  let clearedTimers = 0;

  return {
    exits,
    timers,
    get clearedTimers() {
      return clearedTimers;
    },
    runtime: {
      exit: (code: number) => exits.push(code),
      setTimeout: (callback: () => void, _delayMs: number) => {
        timers.push(callback);
        return 1 as unknown as Timer;
      },
      clearTimeout: (_timer: Timer) => {
        clearedTimers += 1;
      },
      log: () => {},
      error: () => {},
    },
  };
}

test("shutdown closes the server once and exits successfully", async () => {
  let closeCalls = 0;
  const server: ShutdownServer = {
    close: async () => {
      closeCalls += 1;
    },
  };
  const harness = testRuntime();
  const shutdown = createShutdownHandler(server, harness.runtime);

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  await Promise.all([first, second]);

  assert.equal(closeCalls, 1);
  assert.deepEqual(harness.exits, [0]);
  assert.equal(harness.clearedTimers, 1);
});

test("shutdown forces a non-zero exit when the drain timeout fires", async () => {
  let resolveClose!: () => void;
  const server: ShutdownServer = {
    close: () => new Promise<void>((resolve) => {
      resolveClose = resolve;
    }),
  };
  const harness = testRuntime();
  const shutdown = createShutdownHandler(server, harness.runtime, 10);
  const pendingShutdown = shutdown("SIGTERM");

  harness.timers[0]!();
  assert.deepEqual(harness.exits, [1]);

  resolveClose();
  await pendingShutdown;
  assert.deepEqual(harness.exits, [1]);
  assert.equal(harness.clearedTimers, 1);
});

test("SIGTERM and SIGINT are wired to the idempotent shutdown handler", async () => {
  let closeCalls = 0;
  const server: ShutdownServer = {
    close: async () => {
      closeCalls += 1;
    },
  };
  const harness = testRuntime();
  const listeners = new Map<string, () => void>();
  const signalSource = {
    once: (signal: "SIGTERM" | "SIGINT", listener: () => void) => {
      listeners.set(signal, listener);
    },
    off: (signal: "SIGTERM" | "SIGINT") => {
      listeners.delete(signal);
    },
  };

  const removeHandlers = installShutdownHandlers(server, harness.runtime, signalSource);
  listeners.get("SIGTERM")!();
  listeners.get("SIGINT")!();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(closeCalls, 1);
  assert.deepEqual(harness.exits, [0]);
  removeHandlers();
  assert.equal(listeners.size, 0);
});
