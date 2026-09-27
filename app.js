import {
  getBreathingState,
  getPhaseTickCount,
  patternProgressWeight,
  normalizePhases,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const S = {
  phases: [4, 4, 4, 4],
  sessionDurationSeconds: 300,
  maxCycles: 0,
  sound: true,
  voice: false,
  theme: "auto",
};
const KEY = "boxbreath.v1";
const VOICE_PHRASES = ["שאף", "החזק", "נשף", "החזק"];

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
if (S.voice == null) S.voice = false;

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
const stage = $("stage");
const track = $("track"),
  pen = $("pen"),
  glow = $("glow"),
  ticksG = $("ticks"),
  penHead = $("penHead");
track.setAttribute("d", d);
pen.setAttribute("d", d);
glow.setAttribute("d", d);
const PER = pen.getTotalLength();
pen.style.strokeDasharray = `${PER} ${PER}`;
pen.style.strokeDashoffset = PER;

const NS = "http://www.w3.org/2000/svg";

function phaseSegmentFractions(phases) {
  const p = normalizePhases(phases);
  const total = patternProgressWeight(p);
  if (total <= 0) return [];
  const segs = [];
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    if (p[i] <= 0) continue;
    const frac = p[i] / total;
    segs.push({
      phaseIndex: i,
      start: acc,
      end: acc + frac,
      tickCount: getPhaseTickCount(p, i),
    });
    acc += frac;
  }
  return segs;
}

function tickLineAt(pathEl, lengthAt, halfLen) {
  const len = pathEl.getTotalLength();
  const at = Math.max(0, Math.min(len, lengthAt));
  const pt = pathEl.getPointAtLength(at);
  const pt2 = pathEl.getPointAtLength(Math.min(len, at + 1));
  const dx = pt2.x - pt.x,
    dy = pt2.y - pt.y;
  const mag = Math.hypot(dx, dy) || 1;
  const nx = -dy / mag,
    ny = dx / mag;
  const line = document.createElementNS(NS, "line");
  line.setAttribute("class", "tick");
  line.setAttribute("x1", String(pt.x - nx * halfLen));
  line.setAttribute("y1", String(pt.y - ny * halfLen));
  line.setAttribute("x2", String(pt.x + nx * halfLen));
  line.setAttribute("y2", String(pt.y + ny * halfLen));
  return line;
}

function rebuildTicks(phases) {
  ticksG.replaceChildren();
  const segs = phaseSegmentFractions(phases);
  for (const seg of segs) {
    const span = seg.end - seg.start;
    for (let k = 1; k <= seg.tickCount; k++) {
      const t = seg.start + (span * k) / seg.tickCount;
      const line = tickLineAt(track, t * PER, 6);
      line.dataset.phase = String(seg.phaseIndex);
      line.dataset.tick = String(k);
      ticksG.appendChild(line);
    }
  }
}

function updateTickHighlight(state) {
  ticksG.querySelectorAll(".tick").forEach((el) => {
    const pi = +el.dataset.phase;
    const ti = +el.dataset.tick;
    const active =
      pi === state.phaseIndex && ti <= state.phaseTickIndex && running;
    el.classList.toggle("active", active);
  });
}

function placePenHead(patternProgress) {
  const at = Math.max(0, Math.min(PER, patternProgress * PER));
  const pt = pen.getPointAtLength(at);
  penHead.setAttribute("cx", String(pt.x));
  penHead.setAttribute("cy", String(pt.y));
}

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
const tone = (f, dur, gain, type = "sine") => {
  if (!S.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.type = type;
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
const tickBeep = () => tone(620, 0.045, 0.022);
const cornerBeep = () => {
  tone(196, 0.08, 0.04, "triangle");
  tone(294, 0.12, 0.035, "sine");
};
const haptic = (ms) => {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch {}
};

let heVoice = null;
const primeVoices = () => {
  try {
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      heVoice = voices.find((v) => v.lang.startsWith("he")) || null;
    };
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
  } catch {}
};
primeVoices();

function speakPhase(phaseIdx) {
  if (!S.voice) return;
  try {
    if (!heVoice) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(VOICE_PHRASES[phaseIdx]);
    u.lang = "he-IL";
    u.voice = heVoice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch {}
}

let cornerTimer = 0;
function pulseCorner() {
  stage.classList.remove("corner-beat");
  void stage.offsetWidth;
  stage.classList.add("corner-beat");
  clearTimeout(cornerTimer);
  cornerTimer = setTimeout(() => stage.classList.remove("corner-beat"), 160);
}

let running = false;
let sessionStart = 0;
let lastSec = -1;
let lastPhaseIdx = -1;
let lastCycle = 1;
let sessionCyclesCompleted = 0;
let raf = 0;

function paint(state) {
  pen.style.strokeDashoffset = PER * (1 - state.patternProgress);
  placePenHead(state.patternProgress);
  updateTickHighlight(state);
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
  stage.style.transform = `scale(${s.toFixed(4)})`;
}

function applyPhaseTheme(phaseKey) {
  document.body.dataset.phase = phaseKey || "";
}

function applyState(state, initial) {
  paint(state);
  $("phase").textContent = state.phaseLabel;
  $("secs").textContent = state.secondsRemaining || 0;
  $("cycle").textContent = progressLine(state);
  $("nextHint").textContent = running
    ? `הבא: ${state.nextPhaseLabel}`
    : "";
  applyPhaseTheme(state.phaseKey);

  if (state.cycle > lastCycle) {
    const delta = state.cycle - lastCycle;
    stats.today += delta;
    stats.total += delta;
    sessionCyclesCompleted += delta;
    save();
    lastCycle = state.cycle;
  }

  const secNow = Math.floor(state.phaseElapsedSeconds);
  const phaseChanged = state.phaseIndex !== lastPhaseIdx;
  if (phaseChanged) {
    lastPhaseIdx = state.phaseIndex;
    lastSec = secNow;
    if (!initial) {
      pulseCorner();
      cornerBeep();
      haptic(18);
      speakPhase(state.phaseIndex);
    }
  } else if (!initial && secNow !== lastSec) {
    lastSec = secNow;
    if (secNow > 0) {
      tickBeep();
      haptic(4);
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

  $("cycle").textContent = progressLine(state);
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
  pulseCorner();
  cornerBeep();
  haptic(18);
  const state = getBreathingState({
    ...engineConfig(),
    elapsedSeconds: 0,
  });
  applyState(state, true);
  speakPhase(state.phaseIndex);
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
  applyPhaseTheme("");
  pen.style.strokeDashoffset = PER;
  stage.style.transform = "scale(1)";
  placePenHead(0);
  updateTickHighlight({ phaseIndex: -1, phaseTickIndex: -1 });
  stage.classList.remove("corner-beat");

  let summaryElapsed = elapsedSec;
  if (finished && S.sessionDurationSeconds > 0) {
    summaryElapsed = Math.min(elapsedSec, S.sessionDurationSeconds);
  } else if (finishState?.sessionElapsedSeconds != null) {
    summaryElapsed = finishState.sessionElapsedSeconds;
  }

  const ended = wasRunning || finished;
  $("phase").textContent = ended ? "כל הכבוד" : "מושהה";
  $("secs").textContent = S.phases[0];
  $("cycle").textContent = ended
    ? sessionSummaryLine(summaryElapsed, sessionCyclesCompleted)
    : "";
  $("nextHint").textContent = "";
  $("hint").textContent = ended
    ? "הקש כדי להתחיל סבב חדש"
    : "הקש כדי להמשיך";
  $("play").textContent = ended ? "התחל" : "המשך";
  lastPhaseIdx = -1;
  if (finished) {
    tone(660, 0.25, 0.06);
    haptic([12, 60, 12]);
  }
}

stage.addEventListener("click", () => (running ? stop(false) : start()));
stage.addEventListener("keydown", (e) => {
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
$("bVoice").addEventListener("click", (e) => {
  S.voice = !S.voice;
  e.currentTarget.classList.toggle("on", S.voice);
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
  rebuildTicks(S.phases);
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
  rebuildTicks(S.phases);
  if (running) stop(false);
  $("secs").textContent = S.phases[0];
  save();
});

applyTheme();
if (!S.sound) $("bSound").classList.remove("on");
else $("bSound").classList.add("on");
if (!S.voice) $("bVoice").classList.remove("on");
else $("bVoice").classList.add("on");
[0, 1, 2, 3].forEach((i) => {
  $("v" + i).textContent = S.phases[i];
});
syncGoalChips();
rebuildTicks(S.phases);
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
