// navbar.js — glassy, animated top bar with sliding gradient underline + glow

export function mountNavbar(target) {
  // Routes match your router.js (note: Add Orders -> #/add-order, Guests tab)
  const tabs = [
    ["Dashboard", "#/dashboard"],
    ["Check In", "#/check-in"],
    ["In House Guests", "#/in-house"],
    ["Payments", "#/payments"],
    ["Add Orders", "#/add-order"],
    ["Expenses", "#/expenses"],
    ["Check Out", "#/checkout"],
    ["Rooms", "#/rooms"],
    ["Reports", "#/reports"],
    ["Settings", "#/settings"],
    ["Guests", "#/guests"],
  ];

  /* ---------------- structure ---------------- */
  const wrap = el("div", "navbar");
  const btnLeft  = makeArrow("left",  "\u2039"); // ‹
  const btnRight = makeArrow("right", "\u203A"); // ›

  const scroller = el("div", "nav-strip", { role: "tablist" });
  const ink   = el("div", "nav-ink",   { "aria-hidden": "true" });
  const glow  = el("div", "nav-glow",  { "aria-hidden": "true" }); // soft halo for active

  for (const [label, href] of tabs) {
    const a = el("a", "nav-pill", { href, role: "tab" }, label);
    scroller.appendChild(a);
  }
  scroller.append(ink, glow);
  wrap.append(btnLeft, scroller, btnRight);
  target.replaceChildren(wrap);

  /* ---------------- styles (scoped) ---------------- */
  injectCSS(`
  /* theme */
  .navbar{
    --glass: rgba(255,255,255,0.85);
    --bd: #e9edf3;
    --ink: #1f2937;
    --muted: #64748b;
    --accent1:#2563eb; /* blue */
    --accent2:#60a5fa; /* sky */
    --pill-bg:#f6f8ff;
    --pill-bg-active:#eaf1ff;
    --shadow: 0 10px 30px rgba(15,23,42,.06), 0 2px 8px rgba(15,23,42,.06);
  }

  /* container — glass, gradient border ring */
  .navbar{
    position:sticky; top:0; z-index:60;
    display:flex; align-items:center; gap:10px;
    padding:12px 14px;
    background: var(--glass);
    backdrop-filter: blur(8px);
    border:1px solid transparent;
    border-radius:14px;
    margin:10px 12px 0;
    box-shadow: var(--shadow);
    /* conic gradient border */
    background-image:
      linear-gradient(var(--glass), var(--glass)),
      conic-gradient(from 180deg at 50% 50%, #e8edfb, #f1f5ff, #e8edfb);
    background-origin: border-box;
    background-clip: padding-box, border-box;
  }

  /* scrollable strip with edge fades */
  .nav-strip{
    position:relative; flex:1 1 auto; display:flex; gap:6px;
    overflow:auto hidden;
    -webkit-overflow-scrolling: touch;
    padding:2px;
    mask-image: linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent);
  }

  /* pills */
  .nav-pill{
    position:relative; display:inline-block; white-space:nowrap;
    padding:10px 14px;
    color:#334155; text-decoration:none; font-weight:800; letter-spacing:.15px;
    background: var(--pill-bg);
    border:1px solid #e6eaf6;
    border-radius:12px;
    box-shadow: 0 1px 0 rgba(15,23,42,.04);
    transition: transform .18s ease, background .18s ease, color .18s ease, box-shadow .18s ease;
  }
  .nav-pill:hover{
    transform: translateY(-1px);
    background:#eef3ff;
    color:#1d4ed8;
    box-shadow: 0 6px 14px rgba(37,99,235,.12);
  }
  .nav-pill.active{
    color:#1d4ed8;
    background: var(--pill-bg-active);
    border-color:#cfe0ff;
    box-shadow: 0 10px 18px rgba(37,99,235,.16);
  }
  .nav-pill:focus-visible{
    outline:2px solid var(--accent1);
    outline-offset: 2px;
  }

  /* arrows — glassy */
  .nav-arrow{
    width:36px; height:36px; border-radius:12px;
    border:1px solid #e6eaf2; background:#ffffffcf; color:var(--ink);
    font-weight:900; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    transition: background .18s ease, opacity .18s ease, transform .18s ease;
    backdrop-filter: blur(8px);
  }
  .nav-arrow:hover{ background:#f7f9ff; transform: translateY(-1px); }
  .nav-arrow:disabled{ opacity:.35; cursor:not-allowed; transform:none; }

  /* sliding gradient underline */
  .nav-ink{
    position:absolute; height:3px; bottom:2px; left:0; width:0;
    background: linear-gradient(90deg, var(--accent1), var(--accent2));
    border-radius:999px;
    box-shadow: 0 6px 16px rgba(37,99,235,.35);
    transition: transform .25s cubic-bezier(.2,.8,.3,1), width .25s cubic-bezier(.2,.8,.3,1), opacity .2s;
    transform: translateX(var(--u-left, 0px));
    opacity:0;
    pointer-events:none;
  }
  .navbar.has-active .nav-ink{ opacity:1; }

  /* soft glow behind active pill */
  .nav-glow{
    position:absolute; inset:auto 0 0 0; height:46px; pointer-events:none;
    filter: blur(24px); opacity:0; transition: opacity .25s ease, transform .25s ease;
    background: radial-gradient(30% 80% at var(--g-left,50%) 70%, rgba(37,99,235,.25), transparent 70%);
    transform: translateX(var(--g-shift,0px));
  }
  .navbar.has-active .nav-glow{ opacity: .7; }

  @media (max-width: 720px){
    .navbar{ border-radius: 0; margin:0; }
  }
  `);

  /* ---------------- behavior ---------------- */
  function makeArrow(dir, symbol) {
    const b = el("button", `nav-arrow ${dir}`, { "aria-label": dir === "left" ? "Scroll left" : "Scroll right" }, symbol);
    b.addEventListener("click", () => {
      scroller.scrollBy({
        left: (dir === "left" ? -1 : 1) * Math.round(scroller.clientWidth * 0.82),
        behavior: "smooth",
      });
    });
    return b;
  }

  function setActive(hash) {
    const links = [...scroller.querySelectorAll(".nav-pill")];
    const link = links.find(a => a.getAttribute("href") === hash) || links[0];

    links.forEach(a => {
      const is = a === link;
      a.classList.toggle("active", is);
      a.setAttribute("aria-current", is ? "page" : "false");
    });

    // Position underline and glow
    const pad = 8;
    const lr = link.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const left  = (lr.left - sr.left) + scroller.scrollLeft + pad;
    const width = Math.max(0, lr.width - pad * 2);

    ink.style.setProperty("--u-left", `${left}px`);
    ink.style.width = `${width}px`;

    // Glow centers under active pill
    const gCenter = (lr.left - sr.left) + scroller.scrollLeft + lr.width / 2;
    glow.style.setProperty("--g-left", `${gCenter}px`);
    glow.style.setProperty("--g-shift", `0px`);

    wrap.classList.add("has-active");

    // Keep pill centered
    try { link.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); } catch {}
    updateArrows();
  }

  function updateArrows() {
    const max = scroller.scrollWidth - scroller.clientWidth - 1;
    btnLeft.disabled  = scroller.scrollLeft <= 0;
    btnRight.disabled = scroller.scrollLeft >= max;
  }

  // Keep underline aligned while the strip scrolls
  scroller.addEventListener("scroll", () => {
    const active = scroller.querySelector(".nav-pill.active");
    if (active) {
      const pad = 8;
      const lr = active.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const left = (lr.left - sr.left) + scroller.scrollLeft + pad;
      ink.style.setProperty("--u-left", `${left}px`);

      const gCenter = (lr.left - sr.left) + scroller.scrollLeft + lr.width / 2;
      glow.style.setProperty("--g-left", `${gCenter}px`);
    }
    updateArrows();
  }, { passive: true });

  // React to route changes / layout shifts
  const setFromHash = () => setActive(location.hash || "#/dashboard");
  window.addEventListener("hashchange", setFromHash);
  window.addEventListener("resize", setFromHash, { passive: true });
  if (document.fonts && document.fonts.ready) { document.fonts.ready.finally(setFromHash); }

  // Allow router to force it if desired
  window.__navSetActive = setActive;

  // Initial paint
  setFromHash();
  updateArrows();

  /* ---------------- utils ---------------- */
  function el(tag, className, attrs, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    return n;
  }
  function injectCSS(css) {
    const id = "navbar-css-cool";
    if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }
}
