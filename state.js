// state.js — Supabase-backed reactive store with fast sync & realtime
"use strict";

const TABLE  = "frontdesk_state";
const ROW_ID = "singleton";
const OLD_LS_KEY = "hotel-frontdesk-store-v1";
const SAVE_DEBOUNCE_MS = 220;

const EMPTY = {
  guests: [], orders: [], payments: [], expenses: [], stays: [], rooms: [],
  settings: { hotelName: "Hotel", address: "", phone: "", currency: "PKR", currencyLabel: "Rs", locale: "en-PK" }
};

const deepClone = (o) => JSON.parse(JSON.stringify(o || {}));
const sanitize = (s) => {
  const n = deepClone(s || {});
  for (const k of ["guests","orders","payments","expenses","stays","rooms"]) if (!Array.isArray(n[k])) n[k] = [];
  n.settings ||= {}; return n;
};
const diffKeys = (a, b) => Array.from(new Set([ ...Object.keys(a || {}), ...Object.keys(b || {}) ]));

export function money(n) {
  try {
    const S = (store.get().settings) || {};
    const code = S.currency || "PKR";
    const label = S.currencyLabel || "Rs";
    const loc = S.locale || "en-PK";
    const nf = new Intl.NumberFormat(loc, { style: "currency", currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    let out = nf.format(Math.round(Number(n || 0)));
    const sym = nf.formatToParts(1).find(p => p.type === "currency")?.value || "";
    return sym ? out.replace(sym, label) : `${label} ${Math.round(Number(n || 0))}`;
  } catch { return "Rs " + Math.round(Number(n || 0)); }
}

let data = sanitize(EMPTY);
const listeners = new Set();
let lastSavedAt = 0;
let saveTimer = null;

function emitChange(reason, keys) {
  const detail = { reason, keys, data: get() };
  try { window.dispatchEvent(new CustomEvent("store:change", { detail })); } catch {}
  listeners.forEach(fn => { try { fn(detail); } catch {} });
}

function supa() {
  if (!window.supabase) console.warn("[state] Supabase client not found on window. Data will not persist.");
  return window.supabase || null;
}

async function supaLoad() {
  const sb = supa(); if (!sb) return sanitize(data);
  const { data: row, error } = await sb.from(TABLE).select("data, updated_at").eq("id", ROW_ID).maybeSingle();
  if (error && error.code !== "PGRST116") { console.error("[state] load error:", error); return sanitize(data); }
  if (!row) {
    let seed = deepClone(EMPTY);
    try { const raw = localStorage.getItem(OLD_LS_KEY); if (raw) seed = sanitize(JSON.parse(raw)); } catch {}
    const up = await sb.from(TABLE).upsert({ id: ROW_ID, data: seed, updated_at: new Date().toISOString() }).select("data").maybeSingle();
    if (up.error) { console.error("[state] seed error:", up.error); return seed; }
    try { localStorage.removeItem(OLD_LS_KEY); } catch {}
    return sanitize(up.data?.data || seed);
  }
  return sanitize(row.data || EMPTY);
}

async function supaSaveNow() {
  const sb = supa(); if (!sb) return;
  const payload = { id: ROW_ID, data: sanitize(data), updated_at: new Date().toISOString() };
  const { error } = await sb.from(TABLE).upsert(payload);
  if (error) console.error("[state] save error:", error);
  else lastSavedAt = Date.now();
}

function supaSave() {
  const sb = supa(); if (!sb) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(supaSaveNow, SAVE_DEBOUNCE_MS);
}

let rtSub = null;
async function supaRealtime() {
  const sb = supa(); if (!sb?.channel) return;
  try {
    rtSub = sb.channel("frontdesk-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: `id=eq.${ROW_ID}` },
        payload => {
          if (Date.now() - lastSavedAt < 100) return;
          const next = sanitize(payload.new?.data || {});
          if (JSON.stringify(next) !== JSON.stringify(data)) {
            const prev = data; data = next;
            emitChange("remote", diffKeys(prev, next));
            bcPost({ type: "replace", data: next });
          }
        }
      ).subscribe();
  } catch (e) { console.warn("[state] realtime subscribe failed:", e); }
}

let bc = null; try { if ("BroadcastChannel" in window) bc = new BroadcastChannel("frontdesk_state_v1"); } catch {}
function bcPost(m){ try { bc?.postMessage(m); } catch {} }
bc?.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "replace" && m.data) {
    if (JSON.stringify(m.data) !== JSON.stringify(data)) {
      const prev = data; data = sanitize(m.data);
      emitChange("broadcast", diffKeys(prev, data));
    }
  }
});

export const store = {
  get, set, patch, clear,
  subscribe(handler){ if (typeof handler === "function") listeners.add(handler); return () => listeners.delete(handler); },
  refreshFromCloud, flushNow: supaSaveNow
};
try { window.store = store; } catch {}

function get(){ return typeof structuredClone === "function" ? structuredClone(data) : deepClone(data); }

function set(next, reason="set"){
  const prev = data;
  data = sanitize(typeof next === "function" ? next(get()) : (next || {}));
  emitChange(reason, diffKeys(prev, data));
  bcPost({ type:"replace", data });
  supaSave();
}

function patch(partial, reason="patch"){
  if (!partial || typeof partial !== "object") return;
  const prev = data; data = sanitize(Object.assign({}, data, partial));
  emitChange(reason, Object.keys(partial));
  bcPost({ type:"replace", data });
  supaSave();
}

function clear(reason="clear"){
  const prev = data; data = sanitize(EMPTY);
  emitChange(reason, Object.keys(prev || {}));
  bcPost({ type:"replace", data });
  supaSave();
}

export async function refreshFromCloud(){
  try {
    const cloud = await supaLoad();
    const next = sanitize(cloud);
    if (JSON.stringify(next) !== JSON.stringify(data)) {
      const prev = data; data = next;
      emitChange("refresh", diffKeys(prev, next));
      bcPost({ type: "replace", data });
    }
  } catch(e){ console.warn("[state] refreshFromCloud failed:", e); }
}
window.addEventListener("beforeunload", () => { try { navigator.sendBeacon && supaSaveNow(); } catch {} });

(async function init(){
  try {
    const cloud = await supaLoad();
    const prev = data; data = sanitize(cloud);
    emitChange("init", diffKeys(prev, data));
    supaRealtime();
  } catch (e) { console.error("[state] init failed:", e); }
})();
