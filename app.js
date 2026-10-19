/* ═══════════════════════════════════════════════════════════════
   Portal · Planner — application logic.
   ═══════════════════════════════════════════════════════════════ */

import {
  CONFIG, PROVIDERS, DEV,
  getBackend, defaultProfile,
  toast, openSheet, closeSheet,
  portalAI,
  registerServiceWorker, installDevBadge,
  $, $$, escapeHTML,
  todayISO, shiftISO, startOfWeek,
  prettyDate, shortDate, relativeDay, weekdayShort, dayNumber,
  minsToTime, timeToMins
} from "./portal-core.js";

/* ─── State ──────────────────────────────────────────────── */
const state = {
  user: null,
  space: null,
  profile: defaultProfile(),
  subjects: [],
  assignments: [],
  blocks: [],
  notes: [],
  view: "home",
  assignmentFilter: "active",
  weekStart: startOfWeek(todayISO()),
  parsed: [],
  unsubs: []
};

/* ─── Boot ───────────────────────────────────────────────── */
function init() {
  wireAuthUI();
  wireNav();
  wirePortal();
  wireAssignments();
  wireTimebox();
  wireNotes();
  wireSettings();
  registerServiceWorker();
  if (DEV) installDevBadge();

  const backend = getBackend();
  backend.auth.watch(user => {
    state.unsubs.forEach(fn => { try { fn(); } catch {} });
    state.unsubs = [];
    if (!user) {
      state.user = null;
      state.space = null;
      closeSheet();
      $("#authScreen").hidden = false;
      $("#app").hidden = true;
      return;
    }
    state.user = user;
    state.space = backend.forUser(user.uid);
    $("#authScreen").hidden = true;
    $("#app").hidden = false;
    $("#accountEmail").textContent = user.email || user.uid;
    subscribeAll();
  });

  window.addEventListener("unhandledrejection", e => {
    console.error(e.reason);
    const msg = e.reason?.message;
    if (msg) toast(msg);
  });
}

function subscribeAll() {
  const s = state.space;
  const defaults = defaultProfile();
  state.unsubs.push(s.profile.watch(p => {
    state.profile = { ...defaults, ...p, ai: { ...defaults.ai, ...(p.ai || {}) } };
    renderHome();
    renderSettings();
  }));
  state.unsubs.push(s.collection("subjects").watch(items => {
    state.subjects = items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderHome();
    renderAssignments();
    renderTimebox();
    renderSettings();
  }));
  state.unsubs.push(s.collection("assignments").watch(items => {
    state.assignments = items;
    renderHome();
    renderAssignments();
    renderTimebox();
  }));
  state.unsubs.push(s.collection("blocks").watch(items => {
    state.blocks = items;
    renderHome();
    renderTimebox();
  }));
  state.unsubs.push(s.collection("notes").watch(items => {
    state.notes = items.sort((a, b) =>
      (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    renderNotes();
  }));
}

/* ─── Auth UI ────────────────────────────────────────────── */
function wireAuthUI() {
  const backend = getBackend();
  const showErr = msg => {
    const el = $("#authError");
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = msg;
    el.hidden = false;
  };
  const clean = e => (e?.message || String(e)).replace("Firebase: ", "");

  $("#btnSignIn").onclick = async () => {
    showErr("");
    const email = $("#authEmail").value.trim();
    const pass = $("#authPassword").value;
    if (!email || !pass) return showErr("Enter your email and password.");
    try { await backend.auth.signIn(email, pass); }
    catch (e) { showErr(clean(e)); }
  };
  $("#btnSignUp").onclick = async () => {
    showErr("");
    const email = $("#authEmail").value.trim();
    const pass = $("#authPassword").value;
    if (!email || !pass) return showErr("Enter your email and password.");
    if (pass.length < 6) return showErr("Password must be at least 6 characters.");
    try { await backend.auth.signUp(email, pass); }
    catch (e) { showErr(clean(e)); }
  };
  $("#btnGoogle").onclick = async () => {
    showErr("");
    try { await backend.auth.signInGoogle(); }
    catch (e) { showErr(clean(e)); }
  };
  $("#btnSignOut").onclick = () => backend.auth.signOut();
}

/* ─── Nav ────────────────────────────────────────────────── */
function wireNav() {
  $$(".app-nav button").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}
function switchView(view) {
  state.view = view;
  $$(".app-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "home")        renderHome();
  if (view === "assignments") renderAssignments();
  if (view === "timebox")     renderTimebox();
  if (view === "notes")       renderNotes();
  if (view === "settings")    renderSettings();
}

const subjectById = id => state.subjects.find(s => s.id === id);
const subjectChip = subjectId => {
  const s = subjectById(subjectId);
  if (!s) return "";
  return `<span class="chip"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${s.color};margin-right:4px"></span>${escapeHTML(s.name)}</span>`;
};

/* ═══════════════════════════════════════════════════════════
   HOME
   ═══════════════════════════════════════════════════════════ */
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function renderHome() {
  if (!state.user) return;
  const today = todayISO();

  $("#homeEyebrow").textContent = prettyDate(today);
  $("#homeGreeting").textContent = `${greeting()}.`;

  renderFocusCard();
  renderTodayPanels();
}

function renderFocusCard() {
  const card = $("#focusCard");
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayISO();

  const todayBlocks = state.blocks
    .filter(b => b.date === today)
    .sort((a, b) => a.startMin - b.startMin);
  const nextBlock = todayBlocks.find(b => b.startMin + b.durationMins > nowMin);

  const active = state.assignments.filter(a => a.status === "active");
  const overdue = active
    .filter(a => a.dueDate && a.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = active.filter(a => a.dueDate === today);

  card.style.cursor = "default";

  if (overdue.length) {
    const item = overdue[0];
    card.className = "focus-card";
    card.style.borderLeftColor = "var(--danger)";
    card.innerHTML = `
      <div class="focus-label" style="color:var(--danger)">Overdue · ${overdue.length} item${overdue.length === 1 ? "" : "s"}</div>
      <div class="focus-title">${escapeHTML(item.title)}</div>
      <div class="focus-meta">Due ${escapeHTML(relativeDay(item.dueDate))}</div>
    `;
    card.onclick = () => switchView("assignments");
    card.style.cursor = "pointer";
    return;
  }
  if (nextBlock) {
    card.className = "focus-card";
    card.style.borderLeftColor = "";
    const subj = nextBlock.subjectId ? subjectById(nextBlock.subjectId)?.name : "";
    card.innerHTML = `
      <div class="focus-label">Up next</div>
      <div class="focus-title">${escapeHTML(nextBlock.title)}</div>
      <div class="focus-meta">${minsToTime(nextBlock.startMin)} · ${nextBlock.durationMins} min${subj ? " · " + escapeHTML(subj) : ""}</div>
    `;
    card.onclick = () => switchView("timebox");
    card.style.cursor = "pointer";
    return;
  }
  if (dueToday.length) {
    card.className = "focus-card";
    card.style.borderLeftColor = "";
    card.innerHTML = `
      <div class="focus-label">Due today</div>
      <div class="focus-title">${escapeHTML(dueToday[0].title)}</div>
      <div class="focus-meta">${dueToday.length} task${dueToday.length === 1 ? "" : "s"} due today</div>
    `;
    card.onclick = () => switchView("assignments");
    card.style.cursor = "pointer";
    return;
  }
  card.className = "focus-card all-clear";
  card.style.borderLeftColor = "";
  card.style.cursor = "default";
  card.innerHTML = `
    <div class="focus-label">All clear</div>
    <div class="focus-title">Nothing urgent right now.</div>
    <div class="focus-meta">${todayBlocks.length
      ? `You have ${todayBlocks.length} block${todayBlocks.length === 1 ? "" : "s"} scheduled today.`
      : "Enjoy the breather — or get ahead on something."}</div>
  `;
  card.onclick = null;
}

function renderTodayPanels() {
  const today = todayISO();
  const blocks = state.blocks
    .filter(b => b.date === today)
    .sort((a, b) => a.startMin - b.startMin);
    
  $("#todayScheduleCount").textContent = blocks.length;
  $("#todayScheduleList").innerHTML = blocks.length
    ? blocks.map(b => {
        const subject = b.subjectId ? subjectById(b.subjectId) : null;
        const color = b.color || subject?.color || "var(--accent)";
        return `
          <div class="timeline-row">
            <div class="timeline-time">${minsToTime(b.startMin)}</div>
            <div>
              <div class="timeline-title" style="border-left: 3px solid ${color}; padding-left: 8px;">${escapeHTML(b.title)}</div>
              <div class="timeline-meta" style="padding-left: 11px;">${b.durationMins} min${subject ? " · " + escapeHTML(subject.name) : ""}</div>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-panel">No blocks scheduled today.</div>`;

  const tasks = state.assignments
    .filter(a => a.status === "active" && a.dueDate === today)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    
  $("#todayDueCount").textContent = tasks.length;
  $("#todayDueList").innerHTML = tasks.length
    ? tasks.map(a => `
        <div class="timeline-row">
          <div class="timeline-time"></div>
          <div>
            <div class="timeline-title">${escapeHTML(a.title)}</div>
            <div class="timeline-meta">
              ${a.subjectId ? subjectChip(a.subjectId) : ""}
              ${a.estimateMins ? `<span>${a.estimateMins} min</span>` : ""}
            </div>
          </div>
        </div>
      `).join("")
    : `<div class="empty-panel">Nothing due today.</div>`;
}

/* ═══════════════════════════════════════════════════════════
   ASSIGNMENTS
   ═══════════════════════════════════════════════════════════ */
async function toggleAssignment(id, done) {
  await state.space.collection("assignments").update(id, {
    status: done ? "done" : "active",
    completedAt: done ? Date.now() : null
  });
}

function wireAssignments() {
  $("#btnNewAssignment").onclick = () => openAssignmentSheet();
  $$("#assignmentFilters .filter-pill").forEach(pill => {
    pill.onclick = () => {
      state.assignmentFilter = pill.dataset.filter;
      $$("#assignmentFilters .filter-pill").forEach(p =>
        p.classList.toggle("active", p.dataset.filter === state.assignmentFilter));
      renderAssignments();
    };
  });
}

function renderAssignments() {
  if (!state.user) return;
  const filter = state.assignmentFilter;
  const today = todayISO();
  
  let items = state.assignments;
  if (filter === "active") items = items.filter(a => a.status === "active");
  else if (filter === "done") items = items.filter(a => a.status === "done");
  else if (filter === "overdue") items = items.filter(a => a.status === "active" && a.dueDate && a.dueDate < today);

  items.sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return (a.title || "").localeCompare(b.title || "");
  });

  const list = $("#assignmentList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-panel">No assignments found.</div>`;
    return;
  }

  list.innerHTML = items.map(a => {
    const overdue = a.status !== "done" && a.dueDate && a.dueDate < today;
    const dueText = a.dueDate ? (overdue ? "Overdue" : relativeDay(a.dueDate)) : "";
    
    return `
      <div class="list-item ${a.status === "done" ? "done" : ""}" data-id="${a.id}">
        <input type="checkbox" class="checkbox" data-id="${a.id}" ${a.status === "done" ? "checked" : ""}>
        <div class="list-item-body">
          <div class="list-item-title">${escapeHTML(a.title)}</div>
          <div class="list-item-meta">
            ${a.subjectId ? subjectChip(a.subjectId) : ""}
            ${dueText ? `<span style="color:${overdue ? 'var(--danger)' : 'inherit'}">${dueText}</span>` : ""}
            ${a.estimateMins ? `<span>${a.estimateMins} min</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".checkbox").forEach(cb => {
    cb.onchange = () => toggleAssignment(cb.dataset.id, cb.checked);
  });
  list.querySelectorAll(".list-item").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".checkbox")) return;
      const a = state.assignments.find(x => x.id === row.dataset.id);
      if (a) openAssignmentSheet(a);
    });
  });
}

function openAssignmentSheet(existing = null) {
  const subjectsOpts = state.subjects.map(s =>
    `<option value="${s.id}" ${existing?.subjectId === s.id ? "selected" : ""}>${escapeHTML(s.name)}</option>`
  ).join("");

  openSheet({
    title: existing ? "Edit assignment" : "New assignment",
    bodyHTML: `
      <label class="field">
        <span class="field-label">Title</span>
        <input type="text" id="asTitle" placeholder="e.g. Chem lab report" value="${escapeHTML(existing?.title || "")}">
      </label>
      <label class="field">
        <span class="field-label">Subject</span>
        <select id="asSubject">
          <option value="">— No subject —</option>
          ${subjectsOpts}
        </select>
      </label>
      <div class="grid-2">
        <label class="field">
          <span class="field-label">Due date</span>
          <input type="date" id="asDue" value="${existing?.dueDate || ""}">
        </label>
        <label class="field">
          <span class="field-label">Estimate (minutes)</span>
          <input type="number" id="asEstimate" min="0" step="5" value="${existing?.estimateMins || ""}" placeholder="45">
        </label>
      </div>
    `,
    actions: [
      { label: "Cancel", variant: "ghost" },
      {
        label: existing ? "Save" : "Add",
        variant: "primary",
        onClick: async ({ sheet }) => {
          const title = sheet.querySelector("#asTitle").value.trim();
          if (!title) throw new Error("Title is required");
          const payload = {
            title,
            subjectId: sheet.querySelector("#asSubject").value || "",
            dueDate: sheet.querySelector("#asDue").value || "",
            estimateMins: Number(sheet.querySelector("#asEstimate").value) || 0,
            status: existing?.status || "active"
          };
          if (existing) await state.space.collection("assignments").update(existing.id, payload);
          else await state.space.collection("assignments").create(payload);
          toast(existing ? "Saved" : "Assignment added");
        }
      }
    ]
  });
}

/* ═══════════════════════════════════════════════════════════
   PORTAL
   ═══════════════════════════════════════════════════════════ */
function wirePortal() {
  $("#btnParse").onclick = handleParse;
  $("#btnClearPortal").onclick = () => {
    $("#portalInput").value = "";
    state.parsed = [];
    $("#previewWrap").hidden = true;
    $("#parseStatus").textContent = "";
    $("#parseStatus").className = "status";
    $("#parseProgress").hidden = true;
  };
  $("#btnDiscard").onclick = () => {
    state.parsed = [];
    $("#previewWrap").hidden = true;
    $("#parseStatus").textContent = "";
    $("#parseStatus").className = "status";
  };
  $("#btnSave").onclick = handleSaveParsed;
}

// Standard dates only, no academic calendar logic.
const PLANNER_PROMPT = `You are the Portal AI for a planner app. You ALWAYS reply with a single JSON object. No prose. No markdown. No code fences.

RULES:
1. Extract every distinct assignment or task from the text.
2. Resolve every relative date ("tomorrow", "next Friday") to an absolute YYYY-MM-DD based on the context. NEVER invent dates.
3. Match subjects against AVAILABLE SUBJECTS. Use exact IDs.
4. estimateMins is your best realistic estimate of total work time.
5. If the text implies when to schedule the work, include a "schedule" object with date, startMin (mins from midnight), durationMins.

RESPONSE SHAPE:
{
  "assignments": [
    {
      "title": "string",
      "subjectId": "string",
      "dueDate": "YYYY-MM-DD or ''",
      "estimateMins": 0,
      "schedule": { "date": "YYYY-MM-DD", "startMin": 0, "durationMins": 30 } | null
    }
  ]
}`;

function buildPlannerContext() {
  const subjects = state.subjects.length
    ? state.subjects.map(s => `  • ${s.name} (id: ${s.id})`).join("\n")
    : "  (none)";
  const dow = new Date().toLocaleDateString(undefined, { weekday: "long" });

  return `CONTEXT:
  Today: ${todayISO()} (${dow})
  Local time: ${new Date().toLocaleTimeString()}

AVAILABLE SUBJECTS (use exact id):
${subjects}`;
}

const PlannerProfile = {
  appId: "planner",
  systemPrompt: PLANNER_PROMPT,
  context: buildPlannerContext,
  onParsed: parsed => (parsed.assignments || []).map(a => ({
    title: a.title || "",
    subjectId: a.subjectId || "",
    dueDate: a.dueDate || "",
    estimateMins: Number(a.estimateMins) || 0,
    schedule: a.schedule && a.schedule.date && Number.isFinite(a.schedule.startMin) ? a.schedule : null,
    accepted: true
  }))
};

async function handleParse() {
  const text = $("#portalInput").value.trim();
  if (!text) { toast("Paste some text first"); return; }

  const status = $("#parseStatus");
  const progress = $("#parseProgress");
  const ai = state.profile.ai || {};
  const apiKey = (ai.apiKey || "").trim();
  
  if (!apiKey) {
    status.textContent = "Add your API key in Settings first.";
    status.className = "status err";
    return;
  }

  $("#btnParse").disabled = true;
  status.textContent = "";
  status.className = "status";
  progress.hidden = false;
  $("#previewWrap").hidden = true;

  const t0 = performance.now();
  try {
    const items = await portalAI(text, PlannerProfile, {
      apiKey, model: ai.model, provider: ai.provider
    });
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    state.parsed = items;
    renderPreviewCards();
    status.textContent = `Parsed ${items.length} item${items.length === 1 ? "" : "s"} in ${dt}s`;
    status.className = "status ok";
    if (items.length) $("#previewWrap").hidden = false;
  } catch (e) {
    status.textContent = e.message || "Parsing failed";
    status.className = "status err";
  } finally {
    progress.hidden = true;
    $("#btnParse").disabled = false;
  }
}

function renderPreviewCards() {
  const cards = $("#previewCards");
  if (!state.parsed.length) { $("#previewWrap").hidden = true; return; }
  
  cards.innerHTML = state.parsed.map((p, i) => {
    const s = subjectById(p.subjectId);
    return `
      <div class="parse-card ${p.accepted ? "" : "dropped"}" data-i="${i}">
        <div class="parse-card-header">
          <input type="checkbox" class="checkbox" data-toggle="${i}" ${p.accepted ? "checked" : ""}>
          <div class="parse-card-body">
            <div class="list-item-title">${escapeHTML(p.title || "Untitled")}</div>
            <div class="list-item-meta">
              ${s ? subjectChip(s.id) : ""}
              <span class="chip">${escapeHTML(p.dueDate ? relativeDay(p.dueDate) : "No due date")}</span>
              ${p.estimateMins ? `<span class="chip">${p.estimateMins} min</span>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  cards.querySelectorAll("[data-toggle]").forEach(cb => {
    cb.onchange = () => {
      state.parsed[Number(cb.dataset.toggle)].accepted = cb.checked;
      renderPreviewCards();
    };
  });
}

async function handleSaveParsed() {
  const accepted = state.parsed.filter(p => p.accepted && p.title.trim());
  if (!accepted.length) { toast("Nothing to save"); return; }

  const assignmentsCol = state.space.collection("assignments");
  const blocksCol = state.space.collection("blocks");

  for (const p of accepted) {
    const { id } = await assignmentsCol.create({
      title: p.title.trim(), subjectId: p.subjectId || "",
      dueDate: p.dueDate || "", estimateMins: p.estimateMins || 0, status: "active"
    });
    if (p.schedule) {
      await blocksCol.create({
        date: p.schedule.date, startMin: p.schedule.startMin,
        durationMins: p.schedule.durationMins || 30, title: p.title.trim(),
        subjectId: p.subjectId || "", kind: "assignment", refId: id
      });
    }
  }

  toast(`Saved ${accepted.length} assignment${accepted.length === 1 ? "" : "s"}`);
  state.parsed = [];
  $("#portalInput").value = "";
  $("#previewWrap").hidden = true;
  $("#parseStatus").textContent = "";
  switchView("assignments");
}

/* ═══════════════════════════════════════════════════════════
   TIME-BOXING
   ═══════════════════════════════════════════════════════════ */
const TB_START_HOUR = 6;
const TB_END_HOUR = 23;

function wireTimebox() {
  $("#tbPrev").onclick = () => { state.weekStart = shiftISO(state.weekStart, -7); renderTimebox(); };
  $("#tbNext").onclick = () => { state.weekStart = shiftISO(state.weekStart, 7);  renderTimebox(); };
  $("#tbToday").onclick = () => { state.weekStart = startOfWeek(todayISO()); renderTimebox(); };
  $("#tbAddBlock").onclick = () => openBlockSheet();
}

function renderTimebox() {
  if (!state.user) return;
  const weekStart = state.weekStart;
  const weekEnd = shiftISO(weekStart, 6);
  $("#tbSubtitle").textContent = `${shortDate(weekStart)} – ${shortDate(weekEnd)}`;
  const today = todayISO();

  const rows = (TB_END_HOUR - TB_START_HOUR) * 2;
  const parts = [`<div class="wg-corner"></div>`];
  
  for (let i = 0; i < 7; i++) {
    const iso = shiftISO(weekStart, i);
    parts.push(`
      <div class="wg-day-header ${iso === today ? "today" : ""}">
        <span>${weekdayShort(iso)}</span>
        <span style="font-size:14px;font-weight:600">${dayNumber(iso)}</span>
      </div>
    `);
  }

  const weekBlocks = state.blocks.filter(b => b.date >= weekStart && b.date <= weekEnd);

  for (let r = 0; r < rows; r++) {
    const startMin = TB_START_HOUR * 60 + r * 30;
    const timeLabel = startMin % 60 === 0 ? minsToTime(startMin) : "";
    parts.push(`<div class="wg-time">${timeLabel}</div>`);

    for (let i = 0; i < 7; i++) {
      const iso = shiftISO(weekStart, i);
      const blocksHere = weekBlocks.filter(b => 
        b.date === iso && b.startMin < startMin + 30 && (b.startMin + b.durationMins) > startMin
      );
      const content = blocksHere.map(b => {
        const subj = b.subjectId ? subjectById(b.subjectId) : null;
        const color = b.color || subj?.color || "var(--accent)";
        return `<div class="wg-block" data-block="${b.id}" style="background:${color}">${escapeHTML(b.title)}</div>`;
      }).join("");

      parts.push(`<div class="wg-cell" data-date="${iso}" data-start="${startMin}">${content}</div>`);
    }
  }

  $("#weekGrid").innerHTML = parts.join("");

  $$("#weekGrid .wg-cell").forEach(cell => {
    cell.addEventListener("click", e => {
      if (e.target.closest(".wg-block")) return;
      openBlockSheet({ presetDate: cell.dataset.date, presetStart: Number(cell.dataset.start) });
    });
  });
  $$("#weekGrid .wg-block").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      const b = state.blocks.find(x => x.id === el.dataset.block);
      if (b) openBlockSheet({ existing: b });
    });
  });

  renderUnscheduled();
}

function renderUnscheduled() {
  const list = $("#unscheduledList");
  const scheduled = new Set(state.blocks.filter(b => b.kind === "assignment" && b.refId).map(b => b.refId));
  const unscheduled = state.assignments
    .filter(a => a.status === "active" && !scheduled.has(a.id))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  if (!unscheduled.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">All active assignments are scheduled.</div>`;
    return;
  }
  list.innerHTML = unscheduled.map(a => `
    <button class="unscheduled-item" data-schedule-assignment="${a.id}">
      <div style="font-weight:500;margin-bottom:2px">${escapeHTML(a.title)}</div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${a.dueDate ? escapeHTML(relativeDay(a.dueDate)) : "No date"} ${a.estimateMins ? `· ${a.estimateMins}m` : ""}
      </div>
    </button>
  `).join("");
  list.querySelectorAll("[data-schedule-assignment]").forEach(btn => {
    btn.onclick = () => openBlockSheet({ assignmentId: btn.dataset.scheduleAssignment });
  });
}

function openBlockSheet({ existing, presetDate, presetStart, assignmentId } = {}) {
  const assignment = assignmentId ? state.assignments.find(a => a.id === assignmentId) : null;
  const title = existing?.title || assignment?.title || "";
  const date = existing?.date || presetDate || todayISO();
  const startMin = existing?.startMin ?? presetStart ?? 9 * 60;
  const duration = existing?.durationMins || 60;

  const actions = [{ label: "Cancel", variant: "ghost" }];
  if (existing) {
    actions.push({
      label: "Delete", variant: "danger", closeOnClick: false,
      onClick: async ({ close }) => {
        await state.space.collection("blocks").remove(existing.id);
        close(); toast("Block removed");
      }
    });
  }
  actions.push({
    label: existing ? "Save" : "Add",
    variant: "primary",
    onClick: async ({ sheet }) => {
      const finalTitle = sheet.querySelector("#bsTitle").value.trim();
      if (!finalTitle) throw new Error("Title required");
      const payload = {
        date: sheet.querySelector("#bsDate").value || todayISO(),
        startMin: timeToMins(sheet.querySelector("#bsTime").value),
        durationMins: Number(sheet.querySelector("#bsDuration").value) || 30,
        title: finalTitle,
        subjectId: sheet.querySelector("#bsSubject").value || "",
        kind: assignmentId ? "assignment" : (existing?.kind || "custom"),
        refId: assignmentId || existing?.refId || ""
      };
      if (existing) await state.space.collection("blocks").update(existing.id, payload);
      else await state.space.collection("blocks").create(payload);
      toast(existing ? "Block saved" : "Block added");
    }
  });

  openSheet({
    title: existing ? "Edit block" : "New block",
    bodyHTML: `
      <label class="field">
        <span class="field-label">Title</span>
        <input type="text" id="bsTitle" value="${escapeHTML(title)}" placeholder="e.g. Study session">
      </label>
      <div class="grid-2">
        <label class="field">
          <span class="field-label">Date</span>
          <input type="date" id="bsDate" value="${date}">
        </label>
        <label class="field">
          <span class="field-label">Start time</span>
          <input type="time" id="bsTime" value="${minsToTime(startMin)}">
        </label>
      </div>
      <label class="field">
        <span class="field-label">Duration (min)</span>
        <select id="bsDuration">
          ${[30, 45, 60, 90, 120].map(d => `<option value="${d}" ${duration === d ? "selected" : ""}>${d}</option>`).join("")}
        </select>
      </label>
    `,
    actions
  });
}

/* ═══════════════════════════════════════════════════════════
   NOTES
   ═══════════════════════════════════════════════════════════ */
function wireNotes() {
  $("#btnNewNote").onclick = () => openNoteSheet();
}

function renderNotes() {
  if (!state.user) return;
  const list = $("#notesList");
  if (!state.notes.length) {
    list.innerHTML = `<div class="empty-panel">No notes yet. Create one to capture thoughts.</div>`;
    return;
  }
  list.innerHTML = state.notes.map(n => `
    <div class="list-item" data-note="${n.id}" style="cursor:pointer">
      <div class="list-item-body">
        <div class="list-item-title">${escapeHTML(n.title || "Untitled")}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${escapeHTML(n.body || "")}</div>
      </div>
    </div>
  `).join("");
  list.querySelectorAll("[data-note]").forEach(el => {
    el.onclick = () => openNoteSheet(state.notes.find(n => n.id === el.dataset.note));
  });
}

function openNoteSheet(existing = null) {
  const actions = [{ label: "Cancel", variant: "ghost" }];
  if (existing) {
    actions.push({
      label: "Delete", variant: "danger", closeOnClick: false,
      onClick: async ({ close }) => {
        await state.space.collection("notes").remove(existing.id);
        close(); toast("Note deleted");
      }
    });
  }
  actions.push({
    label: "Save", variant: "primary",
    onClick: async ({ sheet }) => {
      const title = sheet.querySelector("#noteTitle").value.trim();
      const body = sheet.querySelector("#noteBody").value.trim();
      if (!title && !body) throw new Error("Note is empty");
      const payload = { title, body, updatedAt: Date.now() };
      if (existing) await state.space.collection("notes").update(existing.id, payload);
      else await state.space.collection("notes").create(payload);
      toast("Saved");
    }
  });

  openSheet({
    title: existing ? "Edit note" : "New note",
    bodyHTML: `
      <label class="field">
        <span class="field-label">Title</span>
        <input type="text" id="noteTitle" placeholder="Optional" value="${escapeHTML(existing?.title || "")}">
      </label>
      <label class="field">
        <span class="field-label">Body</span>
        <textarea id="noteBody" rows="6">${escapeHTML(existing?.body || "")}</textarea>
      </label>
    `,
    actions
  });
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════ */
function wireSettings() {
  $("#btnAddSubject").onclick = async () => {
    await state.space.collection("subjects").create({ name: "New subject", color: "#5C9EAD" });
  };
  $("#btnSaveSettings").onclick = async () => {
    await state.space.profile.update({
      ai: {
        provider: $("#setProvider").value,
        apiKey: $("#setApiKey").value.trim(),
        model: $("#setModel").value
      }
    });
    toast("Settings saved");
  };
  $("#btnTestKey").onclick = async () => {
    const status = $("#keyStatus");
    status.textContent = "Testing…";
    const apiKey = $("#setApiKey").value.trim();
    if (!apiKey) { status.textContent = "No key entered."; status.className = "status err"; return; }
    try {
      const res = await fetch(PROVIDERS[$("#setProvider").value].baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: $("#setModel").value, messages: [{ role: "user", content: "Say OK" }] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.textContent = "Connection works."; status.className = "status ok";
    } catch (e) {
      status.textContent = "Failed."; status.className = "status err";
    }
  };
  $("#setProvider").onchange = () => {
    const prov = PROVIDERS[$("#setProvider").value];
    $("#setModel").innerHTML = prov.models.map(m => `<option value="${m}">${m}</option>`).join("");
  };
}

function renderSettings() {
  if (!state.user) return;
  
  // AI Provider setup
  const selProv = $("#setProvider");
  if (!selProv.options.length) {
    selProv.innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  }
  selProv.value = state.profile.ai?.provider || CONFIG.ai.defaultProvider;
  $("#setApiKey").value = state.profile.ai?.apiKey || "";
  const prov = PROVIDERS[selProv.value];
  const selModel = $("#setModel");
  selModel.innerHTML = prov.models.map(m => `<option value="${m}">${m}</option>`).join("");
  selModel.value = state.profile.ai?.model || prov.defaultModel;

  // Subjects
  const subWrap = $("#subjectList");
  subWrap.innerHTML = state.subjects.map(s => `
    <div class="subject-row" data-id="${s.id}">
      <input type="text" value="${escapeHTML(s.name)}" data-field="name">
      <input type="color" value="${s.color}" data-field="color">
    </div>
  `).join("");
  subWrap.querySelectorAll("[data-field]").forEach(el => {
    el.onchange = async () => {
      const id = el.closest(".subject-row").dataset.id;
      await state.space.collection("subjects").update(id, { [el.dataset.field]: el.value });
    };
  });
}

/* ─── Boot ───────────────────────────────────────────────── */
init();
