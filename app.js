// Set Logbook — offline workout log. Finished workouts live as one markdown
// document (see md.js); the workout in progress is a JSON draft so nothing is
// lost if iOS closes the app mid-session.

const KEYS = { log: "log-md", draft: "draft", unit: "unit", exported: "exported-md", exportedAt: "exported-at", theme: "theme" };
const RPES = ["", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"];
const COMMON = ["Back Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row", "Pull-up", "Romanian Deadlift", "Dip", "Lunge", "Lat Pulldown"];
const FILE_NAME = "training-log.md";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const clone = o => JSON.parse(JSON.stringify(o));
let nextId = 1;
const withIds = list => list.map(w => ({ ...w, id: "w" + nextId++ }));

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const state = { unit: ls.get(KEYS.unit) || "kg", workouts: [], active: null, pendingImport: null };
state.workouts = withIds(parseLog(ls.get(KEYS.log) || "", state.unit));
try { state.active = JSON.parse(ls.get(KEYS.draft)); } catch (e) {}

/* ---------- persistence ---------- */
function saveLog() {
  if (!ls.set(KEYS.log, logMd(state.workouts))) toast("Phone storage is full. Export your log now.");
  renderSync();
}
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => state.active ? ls.set(KEYS.draft, JSON.stringify(state.active)) : ls.del(KEYS.draft), 250);
}
function clearDraft() { clearTimeout(draftTimer); state.active = null; ls.del(KEYS.draft); }

/* ---------- previous numbers for an exercise ---------- */
function lastFor(name, skipMd) {
  const key = name.trim().toLowerCase();
  const prev = [...state.workouts].sort(byNewest)
    .find(w => w.exercises.some(ex => ex.name.trim().toLowerCase() === key && ex.sets.some(hasNumbers)) && workoutMd(w) !== skipMd);
  if (!prev) return null;
  const ex = prev.exercises.find(ex => ex.name.trim().toLowerCase() === key && ex.sets.some(hasNumbers));
  return { date: prev.date, unit: prev.unit, sets: ex.sets.filter(hasNumbers) };
}
const fmtSet = (s, unit) => `${s.weight !== "" ? s.weight + unit + "×" : ""}${s.reps || "?"}${s.rpe ? " @" + s.rpe : ""}`;

/* ---------- current session ---------- */
function startWorkout() {
  state.active = { date: today(), title: "", notes: "", unit: state.unit, exercises: [] };
  saveDraft(); renderSession();
}
function finishWorkout() {
  const w = state.active;
  w.exercises = w.exercises.map(ex => ({ ...ex, sets: ex.sets.filter(hasNumbers) }));
  const i = w.editOf ? state.workouts.findIndex(x => workoutMd(x) === w.editOf) : -1;
  const { editOf, ...done } = w;
  if (i >= 0) state.workouts[i] = { ...done, id: state.workouts[i].id, seq: state.workouts[i].seq };
  else state.workouts.push({ ...done, id: "w" + nextId++, seq: Date.now() });
  clearDraft(); saveLog(); refreshNames();
  renderSession(); renderHistory();
  toast(i >= 0 ? "Workout updated" : "Workout saved");
}

function renderSession() {
  const w = state.active, el = $("session");
  if (!w) {
    el.innerHTML = `<div class="empty"><span>No workout in progress. Start one, add exercises, and log each set as you go. It saves on your phone as you type.</span>
      <button id="start" type="button" class="primary">Start workout</button></div>`;
    $("start").onclick = startWorkout;
    return;
  }
  const rpeOpts = v => RPES.map(r => `<option value="${r}"${r === String(v) ? " selected" : ""}>${r || "–"}</option>`).join("");
  el.innerHTML = `
    <div class="meta">
      <input id="w-date" type="date" value="${esc(w.date)}" aria-label="Date">
      <input id="w-title" type="text" value="${esc(w.title)}" placeholder="Name, e.g. Upper A" aria-label="Workout name">
    </div>
    ${w.exercises.map((ex, i) => {
      const last = lastFor(ex.name, w.editOf);
      const ph = j => (last && last.sets[Math.min(j, last.sets.length - 1)]) || {};
      return `
      <div class="ex">
        <div class="row spread"><span class="ex-name">${esc(ex.name)}</span>
          <button type="button" class="ghost danger" data-act="del-ex" data-i="${i}">Remove</button></div>
        <div class="last">${last
          ? `Last time · ${esc(last.date)}<br><b>${last.sets.map(s => esc(fmtSet(s, last.unit))).join(" · ")}</b>`
          : "First time logging this exercise"}</div>
        <div class="sets">
          <span></span><span class="label">${esc(w.unit)}</span><span class="label">Reps</span><span class="label">RPE</span><span></span>
          ${ex.sets.map((s, j) => `
            <span class="set-no">${j + 1}</span>
            <input class="num" inputmode="decimal" value="${esc(s.weight)}" placeholder="${esc(ph(j).weight)}" data-f="weight" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} weight" id="k-${i}-${j}">
            <input class="num" inputmode="numeric" value="${esc(s.reps)}" placeholder="${esc(ph(j).reps)}" data-f="reps" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} reps" id="r-${i}-${j}">
            <select class="num" data-f="rpe" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} RPE" id="p-${i}-${j}">${rpeOpts(s.rpe)}</select>
            <button type="button" class="ghost" data-act="del-set" data-i="${i}" data-j="${j}" aria-label="Delete set ${j + 1}">×</button>`).join("")}
        </div>
        <button type="button" data-act="add-set" data-i="${i}">+ Set</button>
      </div>`;
    }).join("")}
    <div class="add-ex">
      <input id="ex-input" type="text" list="ex-names" placeholder="Add exercise" aria-label="Exercise name" enterkeyhint="done" autocapitalize="words">
      <button id="ex-add" type="button">Add</button>
    </div>
    <input id="w-notes" type="text" value="${esc(w.notes)}" placeholder="Notes (optional)" aria-label="Notes">
    <div class="row spread">
      <button type="button" class="ghost danger" id="discard">${w.editOf ? "Cancel edit" : "Discard"}</button>
      <button type="button" class="primary" id="finish">${w.editOf ? "Save changes" : "Finish workout"}</button>
    </div>`;

  $("w-date").oninput = e => { w.date = e.target.value || today(); saveDraft(); };
  $("w-title").oninput = e => { w.title = e.target.value.trim(); saveDraft(); };
  $("w-notes").oninput = e => { w.notes = e.target.value.trim(); saveDraft(); };
  const addEx = () => {
    const name = $("ex-input").value.trim().replace(/^#+\s*/, "");
    if (!name) return;
    w.exercises.push({ name, sets: [{ reps: "", weight: "", rpe: "" }] });
    saveDraft(); renderSession();
    $(`k-${w.exercises.length - 1}-0`).focus();
  };
  $("ex-add").onclick = addEx;
  $("ex-input").onkeydown = e => { if (e.key === "Enter") addEx(); };
  armTwice($("discard"), w.editOf ? "Tap again to cancel" : "Tap again to discard", () => { clearDraft(); renderSession(); });
  $("finish").onclick = finishWorkout;
}
$("session").addEventListener("input", e => {
  const t = e.target, w = state.active;
  if (!w || !t.dataset.f) return;
  w.exercises[t.dataset.i].sets[t.dataset.j][t.dataset.f] = t.value.trim().replace(",", ".");
  saveDraft();
});
$("session").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"), w = state.active;
  if (!b || !w) return;
  const i = +b.dataset.i, ex = w.exercises[i];
  if (b.dataset.act === "add-set") ex.sets.push({ ...(ex.sets[ex.sets.length - 1] || { reps: "", weight: "", rpe: "" }) });
  if (b.dataset.act === "del-set") ex.sets.splice(+b.dataset.j, 1);
  if (b.dataset.act === "del-ex") w.exercises.splice(i, 1);
  saveDraft(); renderSession();
});

/* ---------- history ---------- */
function renderHistory() {
  const list = [...state.workouts].sort(byNewest), el = $("history");
  $("hist-count").textContent = list.length ? `${list.length} workout${list.length === 1 ? "" : "s"}` : "";
  const open = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.id));
  if (!list.length) {
    el.innerHTML = `<p class="note">Finished workouts appear here. If you already have a training-log.md, tap Open .md below to load it.</p>`;
    return;
  }
  el.innerHTML = list.map(w => `
    <details data-id="${w.id}"${open.has(w.id) ? " open" : ""}>
      <summary><span class="t">${esc(w.title || w.exercises.map(e => e.name).join(", ") || "Workout")}</span>
        <span class="d">${esc(w.date)} · ${w.exercises.reduce((n, ex) => n + ex.sets.length, 0)} sets</span></summary>
      <div class="detail">
        <pre>${esc(workoutMd(w))}</pre>
        <div class="row">
          <button type="button" data-h="copy">Copy</button>
          <button type="button" data-h="edit">Edit</button>
          <button type="button" class="ghost danger" data-h="del">Delete</button>
        </div>
      </div>
    </details>`).join("");
}
$("history").addEventListener("click", e => {
  const b = e.target.closest("button[data-h]");
  if (!b) return;
  const details = b.closest("details"), w = state.workouts.find(x => x.id === details.dataset.id);
  if (!w) return;
  if (b.dataset.h === "copy") copy(workoutMd(w), details.querySelector("pre"));
  if (b.dataset.h === "edit") {
    if (state.active) { toast("Finish or discard the current workout first"); return; }
    const { id, seq, ...rest } = clone(w);
    state.active = { ...rest, editOf: workoutMd(w) };
    saveDraft(); renderSession(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (b.dataset.h === "del") {
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = "Tap again to delete";
      setTimeout(() => { delete b.dataset.armed; b.textContent = "Delete"; }, 3000);
      return;
    }
    state.workouts = state.workouts.filter(x => x !== w);
    saveLog(); renderHistory(); toast("Workout deleted");
  }
});

/* ---------- the .md file ---------- */
function renderSync() {
  const md = logMd(state.workouts), el = $("sync"), at = ls.get(KEYS.exportedAt);
  const dirty = state.workouts.length > 0 && md !== ls.get(KEYS.exported);
  el.className = "sync " + (dirty ? "warn" : "ok");
  el.textContent = dirty ? "Changes not exported" : at ? "Exported " + new Date(+at).toLocaleDateString() : "";
  $("unsaved-pill").hidden = !dirty;
}
function markExported(md) { ls.set(KEYS.exported, md); ls.set(KEYS.exportedAt, String(Date.now())); renderSync(); }

async function exportLog() {
  const md = logMd(state.workouts);
  // text/plain keeps iOS happy; the .md name is what Files shows
  const file = new File([md], FILE_NAME, { type: "text/plain" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); markExported(md); toast("Exported " + FILE_NAME); }
    catch (e) { if (e.name !== "AbortError") toast("Export didn't work. Try Copy text instead."); }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = FILE_NAME; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  markExported(md);
}
$("export").onclick = exportLog;
$("unsaved-pill").onclick = exportLog;
$("copy-all").onclick = () => copy(logMd(state.workouts));

$("open").onclick = () => $("file-input").click();
$("file-input").onchange = async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const text = await f.text();
  const found = withIds(parseLog(text, state.unit));
  if (!found.length) { toast(`No workouts found in ${f.name}. Workouts start with a heading like "## 2026-10-22".`); return; }
  if (!state.workouts.length) { applyImport(found, "replace"); return; }
  state.pendingImport = found;
  const box = $("import-choice");
  box.hidden = false;
  box.innerHTML = `<span><b>${esc(f.name)}</b> has ${found.length} workout${found.length === 1 ? "" : "s"}. This phone has ${state.workouts.length}.</span>
    <div class="row">
      <button type="button" class="primary" data-imp="merge">Merge</button>
      <button type="button" data-imp="replace">Replace mine</button>
      <button type="button" class="ghost" data-imp="cancel">Cancel</button>
    </div>
    <span class="note">Merge adds workouts this phone doesn't have yet. Replace makes the file your whole log.</span>`;
};
$("import-choice").addEventListener("click", e => {
  const b = e.target.closest("button[data-imp]");
  if (!b) return;
  if (b.dataset.imp !== "cancel") applyImport(state.pendingImport, b.dataset.imp);
  state.pendingImport = null;
  $("import-choice").hidden = true;
});
function applyImport(found, mode) {
  if (mode === "replace") {
    state.workouts = found;
    saveLog(); markExported(logMd(state.workouts));
    toast(`Loaded ${found.length} workouts`);
  } else {
    const have = new Set(state.workouts.map(workoutMd));
    const fresh = found.filter(w => !have.has(workoutMd(w)));
    state.workouts.push(...fresh);
    saveLog();
    toast(fresh.length ? `Added ${fresh.length} workout${fresh.length === 1 ? "" : "s"}` : "Nothing new in that file");
  }
  refreshNames(); renderHistory(); renderSession();
}

/* ---------- helpers ---------- */
function armTwice(btn, armedText, fn) {
  const label = btn.textContent;
  btn.onclick = () => {
    if (btn.dataset.armed) return fn();
    btn.dataset.armed = "1"; btn.textContent = armedText;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
  };
}
function copy(text, pre) {
  const fallback = () => {
    if (!pre) { toast("Copy is blocked. Open a workout and select its text."); return; }
    const r = document.createRange(); r.selectNodeContents(pre);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    toast("Selected. Tap Copy.");
  };
  if (!navigator.clipboard) return fallback();
  navigator.clipboard.writeText(text).then(() => toast("Markdown copied"), fallback);
}
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function refreshNames() {
  const names = new Set(COMMON);
  state.workouts.forEach(w => w.exercises.forEach(ex => names.add(ex.name)));
  $("ex-names").innerHTML = [...names].sort().map(n => `<option value="${esc(n)}">`).join("");
}
function setUnit(u) {
  state.unit = u; ls.set(KEYS.unit, u);
  $("unit-kg").setAttribute("aria-pressed", u === "kg");
  $("unit-lb").setAttribute("aria-pressed", u === "lb");
  if (state.active && state.active.unit !== u) { state.active.unit = u; saveDraft(); renderSession(); }
}
// Theme: follows the phone until the toggle is tapped, then sticks to the choice.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light")) === "dark";
function renderTheme() {
  const dark = isDark();
  $("theme").textContent = dark ? "☀" : "☾";
  $("theme").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? "#101317" : "#f3f5f7"; });
}
$("theme").onclick = () => {
  const t = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = t; ls.set(KEYS.theme, t); renderTheme();
};
darkQuery.addEventListener("change", renderTheme);
$("unit-kg").onclick = () => setUnit("kg");
$("unit-lb").onclick = () => setUnit("lb");

/* ---------- boot ---------- */
setUnit(state.unit); renderTheme();
refreshNames(); renderSession(); renderHistory(); renderSync();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
