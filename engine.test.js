import test from "node:test";
import assert from "node:assert/strict";
import {
  getBreathingState,
  getPatternDurationSeconds,
  effectiveDuration,
  PHASE_KEYS,
  sessionGoalMode,
} from "./engine.js";

test("starts at phase 0 with zero progress and full seconds remaining", () => {
  const s = getBreathingState({
    phases: [4, 4, 4, 4],
    maxCycles: 0,
    elapsedSeconds: 0,
  });
  assert.equal(s.phaseIndex, 0);
  assert.equal(s.phaseKey, PHASE_KEYS[0]);
  assert.equal(s.phaseProgress, 0);
  assert.equal(s.patternProgress, 0);
  assert.equal(s.secondsRemaining, 4);
  assert.equal(s.cycle, 1);
  assert.equal(s.sessionFinished, false);
});

test("phase boundaries and wrap-around", () => {
  const phases = [4, 4, 4, 4];
  const atEndInhale = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: 3.99,
  });
  assert.equal(atEndInhale.phaseIndex, 0);
  assert.ok(atEndInhale.phaseProgress > 0.99);

  const holdStart = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: 4,
  });
  assert.equal(holdStart.phaseIndex, 1);
  assert.equal(holdStart.phaseProgress, 0);
  assert.equal(holdStart.secondsRemaining, 4);

  const cycleTwo = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: 16,
  });
  assert.equal(cycleTwo.phaseIndex, 0);
  assert.equal(cycleTwo.cycle, 2);
  assert.equal(cycleTwo.patternProgress, 0);
});

test("skips zero-length final hold (4-7-8-0)", () => {
  const phases = [4, 7, 8, 0];
  const dur = getPatternDurationSeconds(phases);
  assert.equal(dur, 4 + 7 + 8);

  const nearEnd = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: dur - 0.01,
  });
  assert.equal(nearEnd.phaseIndex, 2);
  assert.ok(nearEnd.phaseProgress > 0.99);

  const wrapped = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: dur,
  });
  assert.equal(wrapped.phaseIndex, 0);
  assert.equal(wrapped.cycle, 2);
});

test("cycle counter increments once per full pattern", () => {
  const phases = [2, 2, 2, 2];
  const pattern = getPatternDurationSeconds(phases);
  for (let c = 1; c <= 5; c++) {
    const s = getBreathingState({
      phases,
      maxCycles: 0,
      elapsedSeconds: pattern * (c - 1),
    });
    assert.equal(s.cycle, c);
  }
});

test("cycle limit stops session precisely", () => {
  const phases = [1, 1, 1, 1];
  const pattern = getPatternDurationSeconds(phases);
  const running = getBreathingState({
    phases,
    maxCycles: 3,
    elapsedSeconds: pattern * 3 - 0.01,
  });
  assert.equal(running.sessionFinished, false);
  assert.equal(running.cycle, 3);

  const done = getBreathingState({
    phases,
    maxCycles: 3,
    elapsedSeconds: pattern * 3,
  });
  assert.equal(done.sessionFinished, true);
});

test("pattern progress from 0 toward 1 within a cycle", () => {
  const phases = [4, 4, 4, 4];
  const pattern = getPatternDurationSeconds(phases);
  const start = getBreathingState({ phases, maxCycles: 0, elapsedSeconds: 0 });
  assert.equal(start.patternProgress, 0);

  const almost = getBreathingState({
    phases,
    maxCycles: 0,
    elapsedSeconds: pattern - 0.05,
  });
  assert.ok(almost.patternProgress > 0.98);
  assert.ok(almost.patternProgress <= 1);
});

test("odd durations (0.5s and 20s)", () => {
  assert.equal(effectiveDuration([0.5, 4, 4, 4], 0), 0.5);
  const half = getBreathingState({
    phases: [0.5, 0, 0, 0],
    maxCycles: 0,
    elapsedSeconds: 0.25,
  });
  assert.equal(half.phaseIndex, 0);
  assert.ok(Math.abs(half.phaseProgress - 0.5) < 0.01);

  const longHold = getBreathingState({
    phases: [1, 20, 1, 1],
    maxCycles: 0,
    elapsedSeconds: 1 + 19.5,
  });
  assert.equal(longHold.phaseIndex, 1);
  assert.ok(longHold.phaseProgress > 0.97);
  assert.equal(longHold.secondsRemaining, 1);
});

test("require() entry loads the engine", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const eng = require("./engine.js");
  assert.equal(typeof eng.getBreathingState, "function");
  assert.deepEqual(eng.PHASE_KEYS, PHASE_KEYS);
});

test("time goal finishes exactly at duration, not before or after", () => {
  const duration = 60;
  const before = getBreathingState({
    phases: [4, 4, 4, 4],
    sessionDurationSeconds: duration,
    maxCycles: 0,
    elapsedSeconds: duration - 0.001,
  });
  assert.equal(before.sessionFinished, false);
  assert.ok(before.sessionRemainingSeconds > 0);
  assert.ok(before.sessionRemainingSeconds < 0.01);
  assert.ok(before.sessionProgress < 1);

  const exact = getBreathingState({
    phases: [4, 4, 4, 4],
    sessionDurationSeconds: duration,
    maxCycles: 0,
    elapsedSeconds: duration,
  });
  assert.equal(exact.sessionFinished, true);
  assert.equal(exact.sessionElapsedSeconds, duration);
  assert.equal(exact.sessionRemainingSeconds, 0);
  assert.equal(exact.sessionProgress, 1);

  const after = getBreathingState({
    phases: [4, 4, 4, 4],
    sessionDurationSeconds: duration,
    maxCycles: 0,
    elapsedSeconds: duration + 5,
  });
  assert.equal(after.sessionFinished, true);
  assert.equal(after.sessionElapsedSeconds, duration);
  assert.equal(after.sessionRemainingSeconds, 0);
});

test("remaining time and progress during a partial time session", () => {
  const duration = 300;
  const elapsed = 127.4;
  const s = getBreathingState({
    phases: [4, 4, 4, 4],
    sessionDurationSeconds: duration,
    maxCycles: 0,
    elapsedSeconds: elapsed,
  });
  assert.equal(s.sessionFinished, false);
  assert.equal(s.sessionElapsedSeconds, elapsed);
  assert.ok(Math.abs(s.sessionRemainingSeconds - (duration - elapsed)) < 0.001);
  assert.ok(Math.abs(s.sessionProgress - elapsed / duration) < 0.0001);
});

test("partial session reports completed elapsed time", () => {
  const elapsed = 130.25;
  const s = getBreathingState({
    phases: [4, 4, 4, 4],
    sessionDurationSeconds: 300,
    maxCycles: 0,
    elapsedSeconds: elapsed,
  });
  assert.equal(s.sessionFinished, false);
  assert.equal(s.sessionElapsedSeconds, elapsed);
  assert.equal(s.cycle, 9);
});

test("time goal and cycle goal never both finish the same session", () => {
  const phases = [1, 1, 1, 1];
  const pattern = getPatternDurationSeconds(phases);
  const cycleFinishElapsed = pattern * 2;
  const timeFinishElapsed = 500;

  const byCycles = getBreathingState({
    phases,
    maxCycles: 2,
    sessionDurationSeconds: 0,
    elapsedSeconds: cycleFinishElapsed,
  });
  assert.equal(byCycles.sessionFinished, true);
  assert.equal(sessionGoalMode({ maxCycles: 2, sessionDurationSeconds: 0 }), "cycles");

  const byTime = getBreathingState({
    phases,
    maxCycles: 2,
    sessionDurationSeconds: timeFinishElapsed,
    elapsedSeconds: timeFinishElapsed,
  });
  assert.equal(byTime.sessionFinished, true);
  assert.equal(
    sessionGoalMode({ maxCycles: 2, sessionDurationSeconds: timeFinishElapsed }),
    "time"
  );
  assert.ok(byTime.sessionElapsedSeconds <= timeFinishElapsed);
  assert.notEqual(byTime.cycle, 2);
});
