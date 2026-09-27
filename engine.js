/**
 * Pure box-breathing state machine (no DOM, timers, or I/O).
 */

const PHASE_KEYS = ["inhale", "hold", "exhale", "holdEnd"];
const PHASE_LABELS = ["שאיפה", "החזקה מלא", "נשיפה", "החזקה ריק"];

/** ~1 tick per second of phase length, at least 1, capped for long holds. */
function getPhaseTickCount(phases, phaseIndex) {
  const dur = effectiveDuration(phases, phaseIndex);
  if (dur <= 0) return 0;
  return Math.min(24, Math.max(1, Math.round(dur)));
}

/** Next active phase index after fromIndex (wraps around the cycle). */
function getNextActivePhaseIndex(phases, fromIndex) {
  const p = normalizePhases(phases);
  let idx = fromIndex;
  for (let guard = 0; guard < 4; guard++) {
    idx = (idx + 1) % 4;
    if (p[idx] > 0) return idx;
  }
  return fromIndex;
}

function enrichPhaseMeta(state, phases) {
  const p = normalizePhases(phases);
  const tickCount = getPhaseTickCount(p, state.phaseIndex);
  const tickIndex =
    tickCount > 0
      ? Math.min(tickCount, Math.floor(state.phaseProgress * tickCount))
      : 0;
  const nextIdx = getNextActivePhaseIndex(p, state.phaseIndex);
  return {
    ...state,
    phaseLabel: PHASE_LABELS[state.phaseIndex] || PHASE_LABELS[0],
    phaseTickCount: tickCount,
    phaseTickIndex: tickIndex,
    nextPhaseIndex: nextIdx,
    nextPhaseKey: PHASE_KEYS[nextIdx],
    nextPhaseLabel: PHASE_LABELS[nextIdx],
  };
}

function effectiveDuration(phases, index) {
  const p = phases[index];
  if (p <= 0) return 0;
  return Math.max(0.5, p);
}

function normalizePhases(phases) {
  const p = (phases || []).slice(0, 4);
  while (p.length < 4) p.push(0);
  return p;
}

function patternProgressWeight(phases) {
  return phases.reduce((a, b) => a + b, 0);
}

function getPatternDurationSeconds(phases) {
  const p = normalizePhases(phases);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += effectiveDuration(p, i);
  return sum;
}

/**
 * After completing phaseIndex, move to the next active phase.
 * @returns {{ phaseIndex: number, cycle: number, finished: boolean, cycleCompleted: boolean }}
 */
function advanceFromPhase(phaseIndex, cycle, phases, maxCycles) {
  let idx = phaseIndex;
  let c = cycle;
  for (let guard = 0; guard < 12; guard++) {
    idx++;
    if (idx > 3) {
      idx = 0;
      c++;
      if (maxCycles > 0 && c > maxCycles) {
        return { phaseIndex: idx, cycle: c, finished: true, cycleCompleted: true };
      }
    }
    if (phases[idx] > 0) {
      return {
        phaseIndex: idx,
        cycle: c,
        finished: false,
        cycleCompleted: idx === 0 && c > cycle,
      };
    }
  }
  return { phaseIndex: 0, cycle: c, finished: true, cycleCompleted: false };
}

function buildState(phases, totalWeight, phaseIndex, cycle, phaseElapsed, sessionFinished) {
  const dur = effectiveDuration(phases, phaseIndex);
  const phaseProgress = dur > 0 ? Math.min(1, phaseElapsed / dur) : 1;
  const completedWeight = phases.slice(0, phaseIndex).reduce((a, b) => a + b, 0);
  const weightDone = completedWeight + phases[phaseIndex] * phaseProgress;
  const patternProgress = totalWeight > 0 ? Math.min(1, weightDone / totalWeight) : 0;
  return {
    phaseIndex,
    phaseKey: PHASE_KEYS[phaseIndex],
    secondsRemaining: dur > 0 ? Math.max(0, Math.ceil(dur - phaseElapsed)) : 0,
    phaseElapsedSeconds: phaseElapsed,
    phaseProgress,
    patternProgress,
    cycle,
    sessionFinished,
    cycleJustCompleted: false,
  };
}

function finishedState(phases, phaseIndex, cycle, totalWeight) {
  return enrichPhaseMeta(
    {
      phaseIndex,
      phaseKey: PHASE_KEYS[phaseIndex] || PHASE_KEYS[0],
      secondsRemaining: 0,
      phaseElapsedSeconds: 0,
      phaseProgress: 1,
      patternProgress: totalWeight > 0 ? 1 : 0,
      cycle: Math.max(1, cycle - 1),
      sessionFinished: true,
      cycleJustCompleted: true,
    },
    phases
  );
}

function attachSessionMetrics(state, sessionElapsed, sessionDurationSeconds) {
  const duration = sessionDurationSeconds > 0 ? sessionDurationSeconds : 0;
  if (duration <= 0) {
    return {
      ...state,
      sessionElapsedSeconds: sessionElapsed,
      sessionRemainingSeconds: 0,
      sessionProgress: 0,
    };
  }
  const elapsed = Math.min(sessionElapsed, duration);
  const remaining = Math.max(0, duration - elapsed);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  return {
    ...state,
    sessionElapsedSeconds: elapsed,
    sessionRemainingSeconds: remaining,
    sessionProgress: progress,
  };
}

/**
 * Core pattern simulation (cycle limit only; no time-based session cap).
 * @param {{ phases: number[], maxCycles?: number, elapsedSeconds: number }} config
 */
function computeBreathingState(config) {
  const phases = normalizePhases(config.phases);
  const maxCycles = config.maxCycles || 0;
  let elapsed = Math.max(0, config.elapsedSeconds || 0);
  const totalWeight = patternProgressWeight(phases);

  if (phases.every((p) => p <= 0)) {
    return enrichPhaseMeta(
      {
        phaseIndex: 0,
        phaseKey: PHASE_KEYS[0],
        secondsRemaining: 0,
        phaseElapsedSeconds: 0,
        phaseProgress: 0,
        patternProgress: 0,
        cycle: 1,
        sessionFinished: true,
        cycleJustCompleted: false,
      },
      phases
    );
  }

  let phaseIndex = 0;
  let cycle = 1;
  let finished = false;

  while (!finished) {
    const dur = effectiveDuration(phases, phaseIndex);
    if (dur <= 0) {
      const adv = advanceFromPhase(phaseIndex, cycle, phases, maxCycles);
      phaseIndex = adv.phaseIndex;
      cycle = adv.cycle;
      finished = adv.finished;
      if (finished) {
        return finishedState(phases, phaseIndex, cycle, totalWeight);
      }
      continue;
    }

    if (elapsed < dur) {
      return enrichPhaseMeta(
        buildState(phases, totalWeight, phaseIndex, cycle, elapsed, false),
        phases
      );
    }

    elapsed -= dur;
    const adv = advanceFromPhase(phaseIndex, cycle, phases, maxCycles);
    phaseIndex = adv.phaseIndex;
    cycle = adv.cycle;
    finished = adv.finished;
    if (finished) {
      return finishedState(phases, phaseIndex, cycle, totalWeight);
    }
  }

  return enrichPhaseMeta(buildState(phases, totalWeight, 0, 1, 0, true), phases);
}

function sessionGoalMode(config) {
  const duration = config.sessionDurationSeconds || 0;
  const maxCycles = config.maxCycles || 0;
  if (duration > 0) return "time";
  if (maxCycles > 0) return "cycles";
  return "unlimited";
}

/**
 * @param {{ phases: number[], maxCycles?: number, sessionDurationSeconds?: number, elapsedSeconds: number }} config
 */
function getBreathingState(config) {
  const sessionDuration = config.sessionDurationSeconds || 0;
  const mode = sessionGoalMode(config);
  let elapsed = Math.max(0, config.elapsedSeconds || 0);

  if (mode === "time") {
    if (elapsed >= sessionDuration) {
      const atGoal = computeBreathingState({
        phases: config.phases,
        maxCycles: 0,
        elapsedSeconds: sessionDuration,
      });
      return attachSessionMetrics(
        enrichPhaseMeta(
          {
            ...atGoal,
            sessionFinished: true,
            cycleJustCompleted: false,
          },
          config.phases
        ),
        sessionDuration,
        sessionDuration
      );
    }
    const state = computeBreathingState({
      phases: config.phases,
      maxCycles: 0,
      elapsedSeconds: elapsed,
    });
    return attachSessionMetrics(
      enrichPhaseMeta({ ...state, sessionFinished: false }, config.phases),
      elapsed,
      sessionDuration
    );
  }

  const state = computeBreathingState({
    phases: config.phases,
    maxCycles: config.maxCycles || 0,
    elapsedSeconds: elapsed,
  });
  return attachSessionMetrics(
    enrichPhaseMeta(state, config.phases),
    elapsed,
    0
  );
}

const engine = {
  PHASE_KEYS,
  PHASE_LABELS,
  effectiveDuration,
  getBreathingState,
  getPatternDurationSeconds,
  getPhaseTickCount,
  getNextActivePhaseIndex,
  advanceFromPhase,
  patternProgressWeight,
  normalizePhases,
  sessionGoalMode,
  computeBreathingState,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = engine;
}
if (typeof globalThis !== "undefined") {
  globalThis.BoxBreathEngine = engine;
}

export {
  PHASE_KEYS,
  PHASE_LABELS,
  effectiveDuration,
  getBreathingState,
  getPatternDurationSeconds,
  getPhaseTickCount,
  getNextActivePhaseIndex,
  advanceFromPhase,
  patternProgressWeight,
  normalizePhases,
  sessionGoalMode,
  computeBreathingState,
};

export default engine;
