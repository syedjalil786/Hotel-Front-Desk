// main.js — fast boot, safe router start, nav prefetch
import { initRouter, prefetchRoute } from "./router.js";

(function cleanup() {
  const ids = ["boot-loader","loader","loading","app-loading"];
  ids.forEach(id => document.getElementById(id)?.remove());
  document.querySelectorAll('[data-loader], [data-boot], .boot-loader, .loading-banner').forEach(el => el.remove());
})();

(function ensureAppContainer() {
  let el = document.querySelector("#app") || document.querySelector("[data-app]");
  if (!el) { el = document.createElement("main"); el.id="app"; document.body.appendChild(el); }
})();

if (!location.hash) location.hash = "#/dashboard";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRouter, { once: true });
} else {
  initRouter();
}

// Prefetch route modules on hover/focus
(function navPrefetch(){
  const getRoute = (href) => (href || "").replace(/^#\/?/, "");
  function onHover(e){
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    const r = getRoute(a.getAttribute("href"));
    if (!r) return;
    try { prefetchRoute(r); } catch {}
  }
  document.addEventListener("mouseover", onHover, { passive: true });
  document.addEventListener("touchstart", onHover, { passive: true });
})();

// Wake state on focus/online so UI is always fresh
window.addEventListener("visibilitychange", () => {
  if (!document.hidden && window.store && typeof window.store.refreshFromCloud === "function") {
    window.store.refreshFromCloud();
  }
});
window.addEventListener("online", () => {
  if (window.store && typeof window.store.refreshFromCloud === "function") window.store.refreshFromCloud();
});
