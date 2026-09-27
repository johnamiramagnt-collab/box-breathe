import { getBreathingState } from "./engine.js";

const $ = (id) => document.getElementById(id);
const S = {
  phases: [4, 4, 4, 4],
  sessionDurationSeconds: 300,
  maxCycles: 0,
  sound: true,
  theme: "auto",
};
const KEY = "boxbreath.v1";
const LABELS = ["שאיפה", "החזקה", "נשיפה", "החזקה"];

const stats = { today: 0, total: 0, day: new Date().toDateString() };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
  Object.assign(S, raw.s || {});
  if (raw.stats) Object.assign(stats, raw.stats);
  if (stats.day !== new Date().toDateString()) {
    stats.day = new Date().toDateString();
    stats.today = 0;
  }
} catch {}

if (S.sessionDurationSeconds == null && S.maxCycles === 0) {
  S.sessionDurationSeconds = 300;
}
if (S.sessionDurationSeconds == null) S.sessionDurationSeconds = 0;

const save = () => {
  stats.day = new Date().toDateString();
  try {
    localStorage.setItem(KEY, JSON.stringify({ s: S, stats }));
  } catch {}
  $("sToday").textContent = stats.today;
  $("sTotal").textContent = stats.total;
};

function engineConfig() {
  return {
    phases: S.phases,
    maxCycles: S.sessionDurationSeconds > 0 ? 0 : S.maxCycles,
    sessionDurationSeconds: S.sessionDurationSeconds,
  };
}

function formatClock(sec) {
  const s = Math.floor(Math.max(0, sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function sessionSummaryLine(elapsedSec, cycles) {
  return `${formatClock(elapsedSec)} · ${cycles} סבבים`;
}

function progressLine(state) {
  if (S.sessionDurationSeconds > 0) {
    return `נשארו ${formatClock(state.sessionRemainingSeconds)}`;
  }
  if (S.maxCycles > 0) {
    return `סבב ${state.cycle} מתוך ${S.maxCycles}`;
  }
  return `סבב ${state.cycle}`;
}

function goalKeyFromSettings() {
  if (S.sessionDurationSeconds > 0) return `time:${S.sessionDurationSeconds}`;
  if (S.maxCycles > 0) return `cycles:${S.maxCycles}`;
  return "unlimited";
}

function applyGoalFromKey(key) {
  if (key === "unlimited") {
    S.sessionDurationSeconds = 0;
    S.maxCycles = 0;
    return;
  }
  const [kind, val] = key.split(":");
  const n = +val;
  if (kind === "time") {
    S.sessionDurationSeconds = n;
    S.maxCycles = 0;
  } else if (kind === "cycles") {
    S.sessionDurationSeconds = 0;
    S.maxCycles = n;
  }
}

function syncGoalChips() {
  const key = goalKeyFromSettings();
  document.querySelectorAll("#goalChips .goal-chip").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.goal === key));
  });
}

const IN = 34,
  SIZE = 300,
  R = 40;
const L = IN,
  T = IN,
  Rt = SIZE - IN,
  B = SIZE - IN;
const d =
  `M ${L + R} ${T} H ${Rt - R} A ${R} ${R} 0 0 1 ${Rt} ${T + R} V ${B - R} ` +
  `A ${R} ${R} 0 0 1 ${Rt - R} ${B} H ${L + R} A ${R} ${R} 0 0 1 ${L} ${B - R} ` +
  `V ${T + R} A ${R} ${R} 0 0 1 ${L + R} ${T} Z`;
const track = $("track"),
  pen = $("pen"),
  glow = $("glow");
track.setAttribute("d", d);
pen.setAttribute("d", d);
glow.setAttribute("d", d);
const PER = pen.getTotalLength();
pen.style.strokeDasharray = `${PER} ${PER}`;
pen.style.strokeDashoffset = PER;

const mq = matchMedia("(prefers-color-scheme: light)");
const applyTheme = () => {
  const light = S.theme === "auto" ? mq.matches : S.theme === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.querySelector('meta[name=theme-color]').content = light
    ? "#f7f8f9"
    : "#0d1014";
};
mq.addEventListener("change", applyTheme);

let ac = null;
const beep = (f, dur, gain) => {
  if (!S.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ac.destination);
    const t = ac.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {}
};
const haptic = (ms) => {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch {}
};

let running = false;
let sessionStart = 0;
let lastSec = -1;
let lastPhaseIdx = -1;
let lastCycle = 1;
let sessionCyclesCompleted = 0;
let raf = 0;

function paint(state) {
  pen.style.strokeDashoffset = PER * (1 - state.patternProgress);
  const { phaseIndex, phaseProgress } = state;
  const expand =
    phaseIndex === 0
      ? phaseProgress
      : phaseIndex === 2
        ? 1 - phaseProgress
        : phaseIndex === 1
          ? 1
          : 0;
  const s = 1 + (expand - 0.5) * 0.06;
  $("stage").style.transform = `scale(${s.toFixed(4)})`;
}

const setPhaseState = (phaseIdx) => {
  document.body.dataset.state =
    phaseIdx === 1 || phaseIdx === 3 ? "hold" : "run";
};

function applyState(state, initial) {
  paint(state);
  $("phase").textContent = LABELS[state.phaseIndex];
  $("secs").textContent = state.secondsRemaining || 0;
  $("cycle").textContent = progressLine(state);
  setPhaseState(state.phaseIndex);

  if (state.cycle > lastCycle) {
    const delta = state.cycle - lastCycle;
    stats.today += delta;
    stats.total += delta;
    sessionCyclesCompleted += delta;
    save();
    lastCycle = state.cycle;
  }

  const secNow = Math.floor(state.phaseElapsedSeconds);
  if (state.phaseIndex !== lastPhaseIdx) {
    lastPhaseIdx = state.phaseIndex;
    lastSec = -1;
  }
  if (!initial && secNow !== lastSec) {
    lastSec = secNow;
    const pi = state.phaseIndex;
    if (secNow > 0)
      beep(pi === 0 ? 528 : pi === 2 ? 396 : 330, 0.05, 0.028);
    if (secNow === 0) {
      beep(pi === 2 ? 396 : pi === 1 ? 440 : 528, 0.12, 0.05);
      haptic(8);
    }
  }
}

function tick(now) {
  if (!running) return;
  const elapsed = (now - sessionStart) / 1000;
  const state = getBreathingState({
    ...engineConfig(),
    elapsedSeconds: elapsed,
  });

  if (state.sessionFinished) {
    if (state.cycleJustCompleted) {
      stats.today++;
      stats.total++;
      sessionCyclesCompleted++;
      save();
    }
    stop(true, state);
    return;
  }

  applyState(state, false);
  raf = requestAnimationFrame(tick);
}

function start() {
  running = true;
  sessionStart = performance.now();
  lastSec = -1;
  lastPhaseIdx = -1;
  lastCycle = 1;
  sessionCyclesCompleted = 0;
  document.body.dataset.state = "run";
  $("play").textContent = "השהה";
  $("hint").textContent = "";
  beep(528, 0.12, 0.05);
  haptic(8);
  const state = getBreathingState({
    ...engineConfig(),
    elapsedSeconds: 0,
  });
  applyState(state, true);
  lastSec = 0;
  raf = requestAnimationFrame(tick);
}

function stop(finished, finishState) {
  const wasRunning = running;
  let elapsedSec = 0;
  if (wasRunning) {
    elapsedSec = (performance.now() - sessionStart) / 1000;
  }
  running = false;
  cancelAnimationFrame(raf);
  document.body.dataset.state = "idle";
  pen.style.strokeDashoffset = PER;
  $("stage").style.transform = "scale(1)";

  let summaryElapsed = elapsedSec;
  if (finished && S.sessionDurationSeconds > 0) {
    summaryElapsed = Math.min(elapsedSec, S.sessionDurationSeconds);
  } else if (finishState?.sessionElapsedSeconds != null) {
    summaryElapsed = finishState.sessionElapsedSeconds;
  }

  const showSummary = wasRunning || finished;
  $("phase").textContent = finished ? "כל הכבוד" : "מושהה";
  $("secs").textContent = S.phases[0];
  $("cycle").textContent = showSummary
    ? sessionSummaryLine(summaryElapsed, sessionCyclesCompleted)
    : "";
  $("hint").textContent = finished
    ? "הקש כדי להתחיל סבב חדש"
    : "הקש כדי להמשיך";
  $("play").textContent = finished ? "התחל" : "המשך";
  lastPhaseIdx = -1;
  if (finished) {
    beep(660, 0.25, 0.06);
    haptic([12, 60, 12]);
  }
}

$("stage").addEventListener("click", () => (running ? stop(false) : start()));
$("stage").addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    running ? stop(false) : start();
  }
});
$("play").addEventListener("click", () => (running ? stop(false) : start()));
$("bSettings").addEventListener("click", () =>
  $("panel").classList.toggle("open")
);
$("bSound").addEventListener("click", (e) => {
  S.sound = !S.sound;
  e.currentTarget.classList.toggle("on", S.sound);
  save();
});
$("bTheme").addEventListener("click", () => {
  S.theme =
    S.theme === "auto" ? "dark" : S.theme === "dark" ? "light" : "auto";
  applyTheme();
  save();
});

$("presets").addEventListener("click", (e) => {
  const b = e.currentTarget.querySelectorAll(".chip");
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const p = btn.dataset.p.split(",").map(Number);
  S.phases = p;
  b.forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
  [0, 1, 2, 3].forEach((i) => {
    if ($("v" + i)) $("v" + i).textContent = S.phases[i] || 0;
  });
  if (running) stop(false);
  $("secs").textContent = S.phases[0];
  save();
});

$("goalChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".goal-chip");
  if (!btn) return;
  applyGoalFromKey(btn.dataset.goal);
  syncGoalChips();
  if (running) stop(false);
  save();
});

$("panel").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  const k = +b.dataset.k,
    dd = +b.dataset.d;
  S.phases[k] = Math.min(20, Math.max(0, (S.phases[k] || 0) + dd));
  $("v" + k).textContent = S.phases[k];
  document
    .querySelectorAll("#presets .chip")
    .forEach((c) => c.setAttribute("aria-pressed", "false"));
  if (running) stop(false);
  $("secs").textContent = S.phases[0];
  save();
});

applyTheme();
if (!S.sound) $("bSound").classList.remove("on");
else $("bSound").classList.add("on");
[0, 1, 2, 3].forEach((i) => {
  $("v" + i).textContent = S.phases[i];
});
syncGoalChips();
$("secs").textContent = S.phases[0];
$("sToday").textContent = stats.today;
$("sTotal").textContent = stats.total;
paint(
  getBreathingState({
    ...engineConfig(),
    elapsedSeconds: 0,
  })
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) stop(false);
});

if (
  (location.protocol === "http:" || location.protocol === "https:") &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
