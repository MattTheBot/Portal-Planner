/* ═══════════════════════════════════════════════════════════════
   Portal Core — shared runtime for every Portal app.
   Owns: config, dev mode, backend (Firebase or memory),
         auth, AI client, toast, sheet, helpers, service worker.
   ═══════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ─── Dev mode ───────────────────────────────────────────── */
// Strategy: "query" → ?dev in URL | "constant" → window.PORTAL_DEV
//           "hostname" → localhost/127.0.0.1 | "off" → never
const DEV_STRATEGY = "query";
export const DEV = (() => {
  try {
    if (DEV_STRATEGY === "query")    return new URLSearchParams(location.search).has("dev");
    if (DEV_STRATEGY === "constant") return window.PORTAL_DEV === true;
    if (DEV_STRATEGY === "hostname")
      return ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname);
  } catch {}
  return false;
})();

/* ─── Config ─────────────────────────────────────────────── */
export const CONFIG = {
  firebase: {
    apiKey: "AIzaSyBFj95AmxGCY01nBsQCnCD3kYhxUh6lklA",
    authDomain: "daily-planner-db712.firebaseapp.com",
    projectId: "daily-planner-db712",
    storageBucket: "daily-planner-db712.firebasestorage.app",
    messagingSenderId: "894061657165",
    appId: "1:894061657165:web:b73655157c89fce5c9f004"
  },
  ai: {
    defaultProvider: "openrouter",
    providers: {
      openrouter: {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        defaultModel: "google/gemini-2.0-flash-exp:free",
        models: [
          "google/gemini-2.0-flash-exp:free",
          "meta-llama/llama-3.3-70b-instruct:free",
          "qwen/qwen-2.5-72b-instruct:free",
          "deepseek/deepseek-r1:free"
        ]
      }
    }
  }
};
export const PROVIDERS = CONFIG.ai.providers;

/* ─── DOM helpers ────────────────────────────────────────── */
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const escapeHTML = v => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ─── IDs ────────────────────────────────────────────────── */
export const uuid = () =>
  crypto.randomUUID?.() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/* ─── Dates ──────────────────────────────────────────────── */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
export const shiftISO = (iso, days) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
export const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
export const startOfWeek = iso => {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  return shiftISO(iso, -dow);
};
export const prettyDate = iso => iso
  ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    })
  : "";
export const shortDate = iso => iso
  ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })
  : "No date";
export const weekdayShort = iso =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
export const dayNumber = iso => new Date(iso + "T00:00:00").getDate();

export function relativeDay(iso) {
  if (!iso) return "";
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 6)   return `In ${diff} days`;
  if (diff < -1 && diff >= -6) return `${-diff} days ago`;
  return shortDate(iso);
}

/* Minutes ↔ "HH:MM" */
export const minsToTime = m => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
};
export const timeToMins = t => {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/* ─── Toast ──────────────────────────────────────────────── */
let _toastTimer;
export function toast(msg) {
  const t = $("#toast");
  if (!t) return console.log("[toast]", msg);
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ─── Sheet / modal ──────────────────────────────────────── */
export function openSheet({ title, bodyHTML = "", actions = [] }) {
  const backdrop = $("#sheet-backdrop");
  const sheet = $("#sheet");
  if (!backdrop || !sheet) return null;

  sheet.innerHTML = `
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <h2 class="sheet-title">${escapeHTML(title || "")}</h2>
      <button class="sheet-close" type="button" aria-label="Close" data-sheet-close>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>
      </button>
    </div>
    <div class="sheet-body">${bodyHTML}</div>
    ${actions.length
      ? `<div class="sheet-actions">${actions.map((a, i) =>
          `<button class="btn ${a.variant || ""}" type="button" data-sheet-action="${i}">${escapeHTML(a.label)}</button>`
        ).join("")}</div>`
      : ""}
  `;

  const close = () => {
    backdrop.classList.remove("open");
    sheet.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    backdrop.onclick = null;
  };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.onclick = close;

  sheet.querySelectorAll("[data-sheet-close]").forEach(b => b.addEventListener("click", close));
  sheet.querySelectorAll("[data-sheet-action]").forEach(b => {
    b.addEventListener("click", async () => {
      const action = actions[Number(b.dataset.sheetAction)];
      if (!action) return;
      if (!action.onClick) { close(); return; }
      try {
        await action.onClick({ close, sheet });
        if (action.closeOnClick !== false) close();
      } catch (err) {
        toast(err?.message || "Something went wrong");
      }
    });
  });

  backdrop.classList.add("open");
  sheet.classList.add("open");
  setTimeout(() => sheet.querySelector("input, textarea, select")?.focus(), 100);

  return { close, sheet };
}

export function closeSheet() {
  $("#sheet-backdrop")?.classList.remove("open");
  $("#sheet")?.classList.remove("open");
}

/* ─── Default profile shape ──────────────────────────────── */
export function defaultProfile() {
  return {
    termStart: "",
    schoolDaysPerWeek: 5,
    breaks: [],
    ai: {
      provider: CONFIG.ai.defaultProvider,
      apiKey: "",
      model: PROVIDERS[CONFIG.ai.defaultProvider].defaultModel
    }
  };
}

/* ─── Backend abstraction ────────────────────────────────── */
let _backend = null;
export function getBackend() {
  if (!_backend) _backend = DEV ? createMemoryBackend() : createFirebaseBackend();
  return _backend;
}

/* ─── Firebase backend ───────────────────────────────────── */
function createFirebaseBackend() {
  const app = initializeApp(CONFIG.firebase);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  getRedirectResult(auth).catch(() => {});

  return {
    auth: {
      watch(cb) { return onAuthStateChanged(auth, cb); },
      signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
      signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
      async signInGoogle() {
        const provider = new GoogleAuthProvider();
        try { await signInWithPopup(auth, provider); }
        catch (e) {
          if (["auth/popup-blocked","auth/popup-closed-by-user","auth/operation-not-supported-in-this-environment"].includes(e.code))
            return signInWithRedirect(auth, provider);
          throw e;
        }
      },
      signOut: () => fbSignOut(auth)
    },
    forUser(uid) {
      const userRef = doc(db, "users", uid);
      return {
        profile: {
          watch(cb) {
            return onSnapshot(userRef, async snap => {
              if (!snap.exists()) {
                await setDoc(userRef, defaultProfile(), { merge: true });
                return;
              }
              cb(snap.data() || {});
            });
          },
          async update(patch) {
            await setDoc(userRef, patch, { merge: true });
          }
        },
        collection(name) {
          const colRef = collection(db, "users", uid, name);
          return {
            watch(cb) {
              return onSnapshot(colRef, snap =>
                cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
            },
            async create(data) {
              const ref = await addDoc(colRef, { ...data, createdAt: serverTimestamp() });
              return { id: ref.id };
            },
            async update(id, patch) {
              await updateDoc(doc(colRef, id), patch);
            },
            async remove(id) {
              await deleteDoc(doc(colRef, id));
            },
            async batch(ops) {
              const b = writeBatch(db);
              for (const op of ops) {
                if (op.type === "remove") b.delete(doc(colRef, op.id));
                else if (op.type === "update") b.update(doc(colRef, op.id), op.data);
                else {
                  const r = op.id ? doc(colRef, op.id) : doc(colRef);
                  b.set(r, { ...op.data, createdAt: serverTimestamp() });
                }
              }
              await b.commit();
            }
          };
        }
      };
    }
  };
}

/* ─── Memory backend (dev) ───────────────────────────────── */
function createMemoryBackend() {
  const user = { uid: "dev-user", email: "dev@portal.local", displayName: "Dev" };
  const spaces = new Map();

  function getSpace(uid) {
    if (spaces.has(uid)) return spaces.get(uid);

    const data = {
      profile: { ...defaultProfile(), termStart: shiftISO(todayISO(), -21) },
      subjects: [
        { id: "s-math", name: "Mathematics", color: "#5C9EAD", createdAt: Date.now() },
        { id: "s-chem", name: "Chemistry",   color: "#8CB369", createdAt: Date.now() },
        { id: "s-hist", name: "History",     color: "#CC6B6B", createdAt: Date.now() }
      ],
      assignments: [
        { id: "a-1", title: "Chem lab report",      subjectId: "s-chem",
          dueDate: shiftISO(todayISO(),  2), estimateMins: 90,  notes: "",
          status: "active", createdAt: Date.now() },
        { id: "a-2", title: "Maths ex 4B q1–12",    subjectId: "s-math",
          dueDate: shiftISO(todayISO(),  1), estimateMins: 45,  notes: "",
          status: "active", createdAt: Date.now() },
        { id: "a-3", title: "History essay draft",  subjectId: "s-hist",
          dueDate: shiftISO(todayISO(), -1), estimateMins: 120, notes: "Focus on the intro",
          status: "active", createdAt: Date.now() },
        { id: "a-4", title: "Physics problem set",  subjectId: "",
          dueDate: shiftISO(todayISO(),  5), estimateMins: 60,  notes: "",
          status: "active", createdAt: Date.now() }
      ],
      blocks: [
        { id: "b-1", date: todayISO(), startMin: 9 * 60,           durationMins: 60,
          title: "Maths ex 4B",       subjectId: "s-math", kind: "assignment",
          refId: "a-2", createdAt: Date.now() },
        { id: "b-2", date: todayISO(), startMin: 14 * 60 + 30,     durationMins: 90,
          title: "Chem lab write-up", subjectId: "s-chem", kind: "assignment",
          refId: "a-1", createdAt: Date.now() },
        { id: "b-3", date: todayISO(), startMin: 17 * 60,          durationMins: 60,
          title: "Football practice", subjectId: "", kind: "custom",
          color: "#E8985E", createdAt: Date.now() }
      ],
      notes: [
        { id: "n-1", title: "Essay structure",
          body: "Intro → context → thesis → 3 body paras → conclusion.\n\nNeed two more primary sources for the second body paragraph.",
          createdAt: Date.now(), updatedAt: Date.now() },
        { id: "n-2", title: "Revision plan for chem",
          body: "Work through past papers Tue/Thu evenings. Focus on organic mechanisms first.",
          createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 }
      ]
    };

    const watchers = {
      profile: new Set(), subjects: new Set(), assignments: new Set(),
      blocks: new Set(), notes: new Set()
    };
    const snap = name => data[name].map(x => ({ ...x }));
    const fire = name =>
      watchers[name].forEach(cb =>
        cb(name === "profile" ? { ...data.profile } : snap(name)));

    const space = {
      profile: {
        watch(cb) {
          watchers.profile.add(cb);
          queueMicrotask(() => { if (watchers.profile.has(cb)) cb({ ...data.profile }); });
          return () => watchers.profile.delete(cb);
        },
        async update(patch) {
          data.profile = { ...data.profile, ...patch };
          fire("profile");
        }
      },
      collection(name) {
        if (!data[name]) data[name] = [];
        return {
          watch(cb) {
            watchers[name].add(cb);
            queueMicrotask(() => { if (watchers[name].has(cb)) cb(snap(name)); });
            return () => watchers[name].delete(cb);
          },
          async create(item) {
            const id = `mem-${name}-${uuid().slice(0, 8)}`;
            data[name].push({ id, ...item, createdAt: Date.now() });
            fire(name);
            return { id };
          },
          async update(id, patch) {
            const i = data[name].findIndex(x => x.id === id);
            if (i < 0) return;
            data[name][i] = { ...data[name][i], ...patch };
            fire(name);
          },
          async remove(id) {
            data[name] = data[name].filter(x => x.id !== id);
            fire(name);
          },
          async batch(ops) {
            for (const op of ops) {
              if (op.type === "remove") {
                data[name] = data[name].filter(x => x.id !== op.id);
              } else if (op.type === "update") {
                const i = data[name].findIndex(x => x.id === op.id);
                if (i >= 0) data[name][i] = { ...data[name][i], ...op.data };
              } else {
                const id = op.id || `mem-${name}-${uuid().slice(0, 8)}`;
                data[name].push({ id, ...op.data, createdAt: Date.now() });
              }
            }
            fire(name);
          }
        };
      }
    };
    spaces.set(uid, space);
    return space;
  }

  return {
    auth: {
      watch(cb) { queueMicrotask(() => cb(user)); return () => {}; },
      signIn: async () => {},
      signUp: async () => {},
      signInGoogle: async () => {},
      signOut: async () => {}
    },
    forUser: getSpace
  };
}

/* ─── AI client ──────────────────────────────────────────── */
export async function portalAI(input, profile, { apiKey, model, provider, onDelta, signal } = {}) {
  if (!apiKey) throw new Error("No API key configured — open Settings.");
  if (!navigator.onLine) throw new Error("AI is unavailable offline.");

  const prov = PROVIDERS[provider || CONFIG.ai.defaultProvider] || PROVIDERS[CONFIG.ai.defaultProvider];
  const useModel = model || prov.defaultModel;

  const sysRaw = typeof profile.systemPrompt === "function" ? profile.systemPrompt() : (profile.systemPrompt || "");
  const ctxRaw = typeof profile.context === "function" ? profile.context() : (profile.context || "");
  const systemText = ctxRaw ? `${sysRaw}\n\n${ctxRaw}` : sysRaw;

  const messages = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  messages.push({ role: "user", content: input });

  const res = await fetch(prov.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin,
      "X-Title": `Portal · ${profile.appId || "app"}`
    },
    body: JSON.stringify({
      model: useModel,
      messages,
      temperature: 0.15,
      response_format: { type: "json_object" },
      stream: true
    }),
    signal
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("No response stream from AI provider.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          acc += delta;
          if (onDelta) onDelta(acc, delta);
        }
      } catch { /* partial */ }
    }
  }

  if (!acc) throw new Error("Empty response from AI.");
  const clean = acc.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(clean);
  return typeof profile.onParsed === "function" ? profile.onParsed(parsed) : parsed;
}

/* ─── Service worker ─────────────────────────────────────── */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ─── Dev badge ──────────────────────────────────────────── */
export function installDevBadge() {
  const b = document.createElement("div");
  b.className = "dev-badge";
  b.textContent = "Dev mode";
  b.title = "No sign-in. Nothing is persisted. Reload to reset.";
  document.body.appendChild(b);
}
