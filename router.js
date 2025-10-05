// router.js — robust hash router (cache-busted imports + safe prefetch)

const V = "4";

function lazy(...imports) {
  return () => {
    let p = Promise.reject();
    for (const path of imports) {
      p = p.catch(() => import(`${path}?v=${V}`));
    }
    return p;
  };
}

const ROUTES = {
  "dashboard":   () => import(`./tabs/dashboard.js?v=${V}`),
  "check-in":    () => import(`./tabs/check-in.js?v=${V}`),
  "inhouse":     lazy("./tabs/in-house.js", "./tabs/inhouse.js"),
  "in-house":    lazy("./tabs/in-house.js", "./tabs/inhouse.js"),
  "payments":    () => import(`./tabs/payments.js?v=${V}`),
  "add-order":   () => import(`./tabs/orders.js?v=${V}`),
  "orders":      () => import(`./tabs/orders.js?v=${V}`),
  "expenses":    () => import(`./tabs/expenses.js?v=${V}`),
  "checkout":    lazy("./tabs/check-out.js", "./tabs/checkout.js"),
  "check-out":   lazy("./tabs/check-out.js", "./tabs/checkout.js"),
  "reports":     () => import(`./tabs/reports.js?v=${V}`),
  "settings":    () => import(`./tabs/settings.js?v=${V}`),
  "rooms":       () => import(`./tabs/rooms.js?v=${V}`),
  "forms":       () => import(`./tabs/forms.js?v=${V}`),
  "guests":      () => import(`./tabs/guests.js?v=${V}`),
  "guest":       () => import(`./tabs/guests.js?v=${V}`),
};

export function initRouter() {
  window.addEventListener("hashchange", render);
  render();
}

export function prefetchRoute(name){
  const loader = ROUTES[name];
  if (loader) { try { return loader(); } catch {} }
  return Promise.resolve();
}

async function render() {
  const target = ensureContainer();
  const { route, query } = parseHash(location.hash);
  try {
    const loader = ROUTES[route] || ROUTES["dashboard"];
    const mod = await loader();
    if (!mod || typeof mod.default !== "function") {
      throw new Error(`View for "${route}" is not a function`);
    }
    const node = await mod.default(query);
    target.innerHTML = "";
    target.appendChild(node || document.createTextNode(""));
    scrollToTop();
    setActiveNav(route);
  } catch (err) {
    const el = ensureContainer();
    el.innerHTML = errorCard(route, err);
    console.error("Failed to load route:", route, err);
  }
}

function ensureContainer() {
  let el = document.querySelector("#app") || document.querySelector("[data-app]");
  if (!el) { el = document.createElement("main"); el.id = "app"; document.body.appendChild(el); }
  return el;
}

function parseHash(h) {
  const clean = String(h || "").replace(/^#\/?/, "");
  const [path, qs = ""] = clean.split("?");
  const route = (path || "dashboard").trim();
  const query = {};
  qs.split("&").forEach(p => {
    if (!p) return;
    const [k, v = ""] = p.split("=");
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return { route, query };
}

function scrollToTop() {
  try { window.scrollTo({ top: 0, behavior: "instant" }); }
  catch { window.scrollTo(0, 0); }
}

function errorCard(route, err) {
  const msg = (err && (err.message || String(err))) || "Unknown error";
  return `<pre style="white-space: pre-wrap; color:#b91c1c; background:#fff7ed; border:1px solid #fecaca; padding:12px; border-radius:8px;">
Failed to load route: ${escapeHTML(route)}
${escapeHTML(msg)}
</pre>`;
}

function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

function setActiveNav(route) {
  const hash = `#/${route || "dashboard"}`;
  document.querySelectorAll('a[href^="#/"]').forEach(a => {
    const isActive = a.getAttribute("href") === hash;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
