
// app-lock.js — one-time overlay lock using localStorage
import { store } from "./state.js";

const LS_KEY = "APP_LOCK_SESSION_V1";
const FAILS_KEY = "APP_LOCK_FAILS";
const BLOCK_UNTIL_KEY = "APP_LOCK_BLOCK_UNTIL";

function getSettings() {
  const d = (store.get?.() || {}).settings || {};
  d.appLockEnabled ??= false;
  d.appLockLabel ??= "App Lock";
  d.appLockSalt ??= "";
  d.appLockHash ??= "";
  return d;
}
const setSession = v => localStorage.setItem(LS_KEY, v);
const getSession = () => localStorage.getItem(LS_KEY) || "";
const clearSession = () => localStorage.removeItem(LS_KEY);

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function installAppLock() {
  const S = getSettings();
  if (!S.appLockEnabled || !S.appLockHash) return;
  const expect = `ok:${S.appLockHash}`;
  if (getSession() === expect) return;

  renderOverlay({
    title: S.appLockLabel || "App Lock",
    onSubmit: async (pin, remember) => {
      // 4-digit+ PIN enforced here.
      if (!/^\d{4,8}$/.test(pin)) throw new Error("Enter 4–8 digit PIN.");
      const now = Date.now();
      const blockedUntil = Number(localStorage.getItem(BLOCK_UNTIL_KEY) || 0);
      if (now < blockedUntil) {
        const left = Math.ceil((blockedUntil - now) / 1000);
        throw new Error(`Too many attempts. Try again in ${left}s.`);
      }
      const ok = (await sha256Hex(`${pin}:${S.appLockSalt}`)) === S.appLockHash;
      if (!ok) {
        const fails = (Number(localStorage.getItem(FAILS_KEY) || 0) + 1);
        localStorage.setItem(FAILS_KEY, String(fails));
        if (fails >= 5) {
          localStorage.setItem(BLOCK_UNTIL_KEY, String(now + 5*60*1000));
          localStorage.setItem(FAILS_KEY, "0");
        }
        throw new Error("Incorrect PIN.");
      }
      localStorage.setItem(FAILS_KEY, "0");
      localStorage.removeItem(BLOCK_UNTIL_KEY);
      if (remember !== false) setSession(expect);
      return true;
    }
  });
}

export async function setAppPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits.");
  const salt = Math.random().toString(36).slice(2) + "-" + Date.now();
  const hash = await sha256Hex(`${pin}:${salt}`);
  store.update?.(prev => {
    const n = { ...(prev || {}) };
    n.settings ||= {};
    n.settings.appLockEnabled = true;
    n.settings.appLockSalt = salt;
    n.settings.appLockHash = hash;
    n.settings.appLockLabel = (n.settings.appLockLabel || "App Lock");
    return n;
  });
  clearSession();
  return true;
}

export function disableAppLock() {
  store.update?.(prev => {
    const n = { ...(prev || {}) };
    n.settings ||= {};
    n.settings.appLockEnabled = false;
    return n;
  });
  clearSession();
}

export function lockNow() {
  clearSession();
  installAppLock();
}

/* ------- overlay UI ------- */
function renderOverlay({ title, onSubmit }) {
  if (document.querySelector('[data-app-lock="overlay"]')) return;
  const wrap = document.createElement("div");
  wrap.setAttribute("data-app-lock","overlay");
  wrap.innerHTML = `
    <div class="al-backdrop"></div>
    <div class="al-card" role="dialog" aria-modal="true">
      <h3 class="al-title">${escapeHtml(title)}</h3>
      <p class="al-sub">Enter your app PIN to continue.</p>
      <div class="al-row">
        <input type="password" inputmode="numeric" pattern="\\d*" maxlength="8" class="al-input" id="al-pin" placeholder="4–8 digit PIN" />
      </div>
      <label class="al-remember"><input type="checkbox" id="al-remember" checked><span>Remember on this device</span></label>
      <div class="al-actions"><button class="al-btn primary" id="al-unlock">Unlock</button></div>
      <div class="al-error" id="al-error" aria-live="polite"></div>
    </div>
    <style>
      [data-app-lock="overlay"]{position:fixed;inset:0;z-index:99999;font:15px/1.4 system-ui,Segoe UI,Roboto,Arial}
      .al-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px)}
      .al-card{position:relative;max-width:360px;width:92vw;background:#fff;border:1px solid #e5e7eb;border-radius:14px;margin:14vh auto 0;padding:16px;box-shadow:0 20px 60px rgba(2,8,23,.25)}
      .al-title{margin:0 0 4px 0;font-weight:800}
      .al-sub{margin:0 0 12px 0;color:#64748b}
      .al-row{display:flex;gap:8px;margin-bottom:8px}
      .al-input{flex:1 1 auto;height:40px;border:1px solid #e5e7eb;border-radius:10px;padding:0 12px;background:#f8fafc;letter-spacing:3px;text-align:center;font-weight:800}
      .al-remember{display:flex;align-items:center;gap:8px;color:#64748b;margin-bottom:10px}
      .al-actions{display:flex;gap:8px;justify-content:flex-end}
      .al-btn{height:40px;padding:0 14px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;font-weight:800;cursor:pointer}
      .al-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
      .al-error{margin-top:8px;color:#b91c1c;font-weight:600;min-height:1em}
    </style>`;
  document.body.appendChild(wrap);
  const pinEl = wrap.querySelector("#al-pin");
  const remEl = wrap.querySelector("#al-remember");
  const errEl = wrap.querySelector("#al-error");
  const btn = wrap.querySelector("#al-unlock");
  const submit = async () => {
    errEl.textContent = ""; btn.disabled = true;
    try { const ok = await onSubmit(pinEl.value || "", remEl.checked); if (ok) wrap.remove(); }
    catch (e) { errEl.textContent = e?.message || "Failed."; }
    finally { btn.disabled = false; pinEl.focus(); pinEl.select(); }
  };
  btn.addEventListener("click", submit);
  pinEl.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  setTimeout(() => pinEl.focus(), 60);
}
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
