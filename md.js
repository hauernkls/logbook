// Markdown <-> workouts. The .md file is the source of truth, so parsing is
// forgiving: it accepts this app's own output, the Claude logbook's export,
// and light hand edits. Unrecognised lines inside a workout become notes.
//
// Format written:
//   # Training Log
//
//   ## 2026-10-22 — Upper A
//
//   ### Bench Press
//   - Set 1: 5 reps × 80 kg @ RPE 8
//
//   **Notes:** felt strong
//
// Templates follow the workouts, same exercise and set lines:
//   ## Template: Upper A

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]+\s*(.*))?$/;
const TPL_RE = /^template\s*[:—–-]\s*(.+)$/i;
const SET_RE = /^[-*]\s*(?:set\s*\d+\s*:\s*)?(\d+|\?)?\s*(?:reps?)?\s*(?:[×x*]\s*([\d.,]+)\s*(kg|lbs?)?)?\s*(?:@\s*(?:rpe\s*)?([\d.,]+))?\s*$/i;

// One "- Set 1: 5 reps × 80 kg @ RPE 8" line -> { set, unit }, or null.
function parseSet(line) {
  const s = line.match(SET_RE);
  if (!s || !(s[1] || s[2])) return null;
  return {
    set: {
      reps: s[1] && s[1] !== "?" ? s[1] : "",
      weight: (s[2] || "").replace(",", "."),
      rpe: (s[4] || "").replace(",", "."),
    },
    unit: s[3] ? (/^lb/i.test(s[3]) ? "lb" : "kg") : "",
  };
}

function parseLog(md, defaultUnit) {
  const workouts = [];
  let w = null, ex = null;
  const addNote = text => { w.notes = w.notes ? w.notes + " " + text : text; };
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      if (TPL_RE.test(h[1].trim())) { w = null; ex = null; continue; }
      const d = h[1].trim().match(DATE_RE);
      if (d) {
        w = { date: d[1], title: (d[2] || "").trim(), notes: "", unit: "", exercises: [] };
        workouts.push(w);
        ex = null;
      } else if (w) {
        ex = { name: h[1].trim(), sets: [] };
        w.exercises.push(ex);
      }
      continue;
    }
    if (!w || !line || /^-{3,}$/.test(line)) continue;
    const note = line.match(/^\*\*notes:?\*\*:?\s*(.*)$/i);
    if (note) { if (note[1]) addNote(note[1]); continue; }
    if (ex) {
      if (/^[-*]\s*\(no sets\)$/i.test(line)) continue;
      const s = parseSet(line);
      if (s) {
        ex.sets.push(s.set);
        if (s.unit && !w.unit) w.unit = s.unit;
        continue;
      }
    }
    addNote(line.replace(/^[-*]\s*/, ""));
  }
  // file order is newest first; seq keeps that order for workouts on the same date
  workouts.forEach((w, i) => { w.unit = w.unit || defaultUnit || "kg"; w.seq = workouts.length - i; });
  return workouts;
}

function parseTemplates(md, defaultUnit) {
  const templates = [];
  let t = null, ex = null;
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      const name = h[1].trim().match(TPL_RE);
      if (name) { t = { name: name[1].trim(), unit: "", exercises: [] }; templates.push(t); ex = null; }
      else if (DATE_RE.test(h[1].trim())) t = null;
      else if (t) { ex = { name: h[1].trim(), sets: [] }; t.exercises.push(ex); }
      continue;
    }
    const s = t && ex && parseSet(line);
    if (s) {
      ex.sets.push(s.set);
      if (s.unit && !t.unit) t.unit = s.unit;
    }
  }
  templates.forEach(t => { t.unit = t.unit || defaultUnit || "kg"; });
  return templates;
}

function setLine(s, i, unit) {
  let line = `- Set ${i + 1}: ${s.reps || "?"} reps`;
  if (s.weight !== "") line += ` × ${s.weight} ${unit}`;
  if (s.rpe) line += ` @ RPE ${s.rpe}`;
  return line;
}

const hasNumbers = s => s.reps !== "" || s.weight !== "";

function workoutMd(w) {
  const lines = [`## ${w.date}${w.title ? " — " + w.title : ""}`];
  for (const ex of w.exercises) {
    lines.push("", `### ${ex.name}`);
    const sets = ex.sets.filter(hasNumbers);
    if (!sets.length) lines.push("- (no sets)");
    sets.forEach((s, i) => lines.push(setLine(s, i, w.unit)));
  }
  if (w.notes) lines.push("", "**Notes:** " + w.notes);
  return lines.join("\n");
}

function templateMd(t) {
  const lines = [`## Template: ${t.name}`];
  for (const ex of t.exercises) {
    lines.push("", `### ${ex.name}`);
    ex.sets.forEach((s, i) => lines.push(setLine(s, i, t.unit)));
  }
  return lines.join("\n");
}

const byNewest = (a, b) => b.date.localeCompare(a.date) || b.seq - a.seq;

function logMd(workouts, templates = []) {
  const parts = [...workouts].sort(byNewest).map(workoutMd).concat(templates.map(templateMd));
  return "# Training Log\n" + (parts.length ? "\n" + parts.join("\n\n") + "\n" : "");
}
