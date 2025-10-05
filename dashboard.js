// tabs/dashboard.js — Smart Dashboard with SVG Revenue Trend (no auto-grow)
// Replaces canvas chart with responsive SVG using fixed viewBox.

import { store } from "../state.js";

/* ---------------- utils ---------------- */
const today = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const round2 = n => Math.round(Number(n || 0) * 100) / 100;

function getState() { try { if (typeof store?.get === "function") return store.get(); } catch { } return (window.__APP_STATE__ || {}); }
function ensure(d) {
    const n = d ? { ...d } : {};
    for (const k of ["guests", "stays", "orders", "payments", "expenses", "rooms"]) if (!Array.isArray(n[k])) n[k] = [];
    n.settings ||= {}; return n;
}
import { money } from "../state.js";

function datesBetween(from, to) { const out = [], s = new Date(from + "T00:00:00"), e = new Date(to + "T00:00:00"); for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1))out.push(d.toISOString().slice(0, 10)); return out; }
function diffNights(aISO, bISO) { if (!aISO || !bISO) return 0; const a = new Date(aISO + "T00:00:00"), b = new Date(bISO + "T00:00:00"); return Math.max(0, Math.floor((b - a) / 86400000)); }
function overlapNights(a, b, from, to) { const s = new Date((a > from ? a : from) + "T00:00:00"); const e = new Date((b < to ? b : to) + "T00:00:00"); return Math.max(0, Math.floor((e - s) / 86400000)); }
function uniqueRooms(list) { const s = new Set(); for (const g of list) { const r = String(g.roomNo || "").trim(); if (r) s.add(r); } return Array.from(s); }

const coerceISO = v => {
    if (v == null) return "";
    if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};
const detectISODate = obj => {
    if (!obj || typeof obj !== "object") return "";
    const keys = ["date", "datetime", "createdAt", "created", "orderDate", "paymentDate", "expenseDate", "ts", "time", "at", "on"];
    for (const k of keys) { if (k in obj) { const iso = coerceISO(obj[k]); if (iso) return iso; } }
    for (const v of Object.values(obj)) { const iso = coerceISO(v); if (iso) return iso; if (typeof v === "string") { const m = v.match(/\d{4}-\d{2}-\d{2}/); if (m) return m[0]; } }
    return "";
};
const detectAmount = obj => {
    if (!obj || typeof obj !== "object") return 0;
    const keys = ["amount", "total", "price", "value", "amt", "paid", "cost", "grandTotal", "net", "gross"];
    for (const k of keys) {
        const v = obj[k]; if (v == null) continue;
        if (typeof v === "number" && isFinite(v)) return v;
        if (typeof v === "string") { const num = v.replace(/[^\d.-]/g, ""); if (!isNaN(num)) return Number(num); }
    }
    for (const v of Object.values(obj)) {
        if (typeof v === "number" && isFinite(v)) return v;
        if (typeof v === "string") { const num = v.replace(/[^\d.-]/g, ""); if (!isNaN(num)) return Number(num); }
    }
    return 0;
};

function seriesBy(items, from, to, getDate, getVal) {
    const days = datesBetween(from, to), map = new Map(days.map(d => [d, 0]));
    for (const it of (items || [])) {
        const iso = getDate(it); if (!iso || iso < from || iso > to) continue;
        map.set(iso, Number(map.get(iso) || 0) + Number(getVal(it) || 0));
    }
    return days.map(d => ({ date: d, value: round2(map.get(d) || 0) }));
}
const sumSeries = s => s.reduce((a, b) => a + Number(b.value || 0), 0);

/* room revenue by day (stays + in-house) */
function roomRevenueSeries(D, from, to) {
    const days = datesBetween(from, to), map = new Map(days.map(d => [d, 0]));
    const addRange = (a, b, rate) => {
        const s = new Date(a + "T00:00:00"), e = new Date(b + "T00:00:00");
        for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
            const iso = d.toISOString().slice(0, 10); if (iso < from || iso > to) continue;
            map.set(iso, Number(map.get(iso) || 0) + Number(rate || 0));
        }
    };
    for (const s of (D.stays || [])) { const a = (s.checkIn || "").slice(0, 10), b = (s.checkOut || "").slice(0, 10); if (!a || !b) continue; addRange(a, b, s.rate || s.roomRent || 0); }
    const inhouse = (D.guests || []).filter(g => (g.status || "checked-in") === "checked-in" && !g.checkedOut);
    for (const g of inhouse) { const a = (g.checkInDate || "").slice(0, 10); if (!a) continue; const b = (g.checkOutDate || to).slice(0, 10); addRange(a, b, g.roomRent || 0); }
    return days.map(d => ({ date: d, value: round2(map.get(d) || 0) }));
}

/* ---------------- main view ---------------- */
export default async function view() {
    const host = document.createElement("section");
    host.className = "card"; host.setAttribute("data-view", "dashboard");
    host.innerHTML = `
  <header class="view-header">
    <h2>Smart Dashboard</h2>
    <div class="filters">
      <label>From <input class="input" type="date" id="dash-from"/></label>
      <label>To <input class="input" type="date" id="dash-to"/></label>
      <div class="quick">
        <button class="btn ghost" data-r="today">Today</button>
        <button class="btn ghost" data-r="7d">Last 7D</button>
        <button class="btn ghost" data-r="mtd">MTD</button>
        <button class="btn ghost" data-r="30d">Last 30D</button>
      </div>
      <button class="btn primary" id="dash-print" type="button">Print</button>
    </div>
  </header>

  <div class="kpi-row">
    <div class="kpi"><div class="kpi-title">In House</div><div class="kpi-value" id="kpi-in">0</div><div class="kpi-foot" id="kpi-ad">Arrivals 0 • Departures 0</div></div>
    <div class="kpi"><div class="kpi-title">Occupancy</div><div class="kpi-value" id="kpi-occ">—</div><div class="kpi-foot" id="kpi-rooms">0/0 Rooms</div></div>
    <div class="kpi"><div class="kpi-title">Outstanding Dues</div><div class="kpi-value danger" id="kpi-due">Rs 0.00</div><div class="kpi-foot">Across checked-in</div></div>
    <div class="kpi"><div class="kpi-title">Overdue Checkouts</div><div class="kpi-value warn" id="kpi-ovr">0</div><div class="kpi-foot">Past expected date</div></div>
  </div>

  <div class="kpi-row wide">
    <div class="kpi"><div class="kpi-title">Room Revenue</div><div class="kpi-value" id="kpi-room">Rs 0.00</div><div class="kpi-foot">ADR <span id="kpi-adr">Rs 0.00</span> • Nights <span id="kpi-ngt">0</span></div></div>

    <div class="kpi clock-card">
      <div class="kpi-title">Local Time</div>
      <div class="clock" id="dash-clock">
        <span class="h">00</span><span class="sep">:</span><span class="m">00</span><span class="sep">:</span><span class="s">00</span>
        <span class="ampm">AM</span>
      </div>
      <div class="kpi-foot" id="clock-date">—</div>
    </div>

    <div class="kpi"><div class="kpi-title">Total Revenue</div><div class="kpi-value" id="kpi-trev">Rs 0.00</div><div class="kpi-foot">Room + Orders</div></div>
    <div class="kpi"><div class="kpi-title">RevPAR</div><div class="kpi-value" id="kpi-rvp">Rs 0.00</div><div class="kpi-foot">Per available room</div></div>
  </div>

  <div class="grid">
    <section class="panel">
      <div class="panel-head"><h3>Revenue Trend</h3><span class="muted" id="trend-cap"></span></div>
      <!-- Responsive SVG: fixed viewBox prevents runaway growth -->
      <svg id="rev-svg" viewBox="0 0 600 160" preserveAspectRatio="none" width="100%" height="160" role="img" aria-label="Revenue Trend"></svg>
      <div class="legend"><span class="dot room"></span>Room <span class="dot orders"></span>Orders <span class="dot total"></span>Total</div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Due Watchlist</h3><span class="muted">Top 5 in-house dues</span></div>
      <div class="table-wrap">
        <table class="table mini">
          <thead><tr><th>Guest</th><th>Room</th><th class="r">Due</th><th class="col-actions">Action</th></tr></thead>
          <tbody id="due-rows"><tr><td colspan="4" class="muted tc">No dues</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Departures Today</h3><span class="muted" id="dep-cap"></span></div>
      <div class="table-wrap">
        <table class="table mini">
          <thead><tr><th>Guest</th><th>Room</th><th>Out</th><th class="r">Due</th><th class="col-actions">Action</th></tr></thead>
          <tbody id="dep-rows"><tr><td colspan="5" class="muted tc">No departures</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Recent Activity</h3><span class="muted">Payments & Expenses</span></div>
      <div class="table-wrap">
        <table class="table mini">
          <thead><tr><th>Date</th><th>Type</th><th>Ref/Guest</th><th class="r">Amount</th></tr></thead>
          <tbody id="act-rows"><tr><td colspan="4" class="muted tc">No activity</td></tr></tbody>
        </table>
      </div>
    </section>
  </div>

  <section class="panel">
    <div class="panel-head"><h3>Reminders</h3><span class="muted" id="rem-cap"></span></div>
    <div class="rem-grid">
      <div class="cardx"><div class="cardx-head">Arrivals Today (<span id="arr-count">0</span>)</div><ul class="list" id="arr-list"><li class="muted">No arrivals today</li></ul></div>
      <div class="cardx"><div class="cardx-head">Upcoming Bookings (7 days) (<span id="bk-count">0</span>)</div><ul class="list" id="bk-list"><li class="muted">No upcoming bookings</li></ul></div>
    </div>
  </section>

  <div class="actions-bar">
    <a class="btn primary" href="#/check-in">New Check-In</a>
    <a class="btn ghost" href="#/payments">Add Payment</a>
    <a class="btn ghost" href="#/add-order">Add Order</a>
    <a class="btn ghost" href="#/checkout">Go to Check Out</a>
    <a class="btn ghost" href="#/reports">Open Reports</a>
    <a class="btn ghost" href="#/settings">Settings</a>
  </div>
  `;

    const style = document.createElement("style");
    style.textContent = `
    [data-view="dashboard"]{--border:#e5e7eb;--muted:#6b7280;--shadow:0 10px 30px rgba(2,8,23,.06),0 2px 8px rgba(2,8,23,.06)}
    .filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f9fafb}
    .btn{height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
    .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
    .btn.ghost{background:#f7f9ff;border-color:#e6eaf2}
    .kpi-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}
    .kpi-row.wide{grid-template-columns:repeat(4,minmax(0,1fr))}
    .kpi{border:1px solid var(--border);border-radius:14px;padding:12px;background:#fff;box-shadow:var(--shadow);min-width:0}
    .kpi-title{font-size:12px;color:var(--muted);margin-bottom:6px}
    .kpi-value{font-size:20px;font-weight:800}
    .kpi-value.warn{color:#f59e0b}.kpi-value.danger{color:#dc2626}
    .kpi-foot{font-size:12px;color:var(--muted)}
    .clock-card .clock{display:flex;align-items:baseline;gap:6px;font-weight:800;letter-spacing:1px}
    .clock-card .clock .h,.clock-card .clock .m,.clock-card .clock .s{font-size:28px}
    .clock-card .clock .sep{font-size:26px;color:#9ca3af}
    .clock-card .clock .ampm{font-size:12px;color:#6b7280;margin-left:4px}
    .grid{display:grid;grid-template-columns:1.4fr 1fr;gap:12px}
    .panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;display:flex;flex-direction:column;gap:10px}
    .panel-head{display:flex;align-items:center;justify-content:space-between}
    .legend{display:flex;gap:12px;font-size:12px}
    .legend .dot{display:inline-block;width:10px;height:10px;border-radius:999px;margin-right:4px}
    .legend .room{background:#34d399}.legend .orders{background:#60a5fa}.legend .total{background:#111827}
    .table{width:100%;border-collapse:separate;border-spacing:0}
    .table.mini thead th{background:#f8fafc;border-bottom:1px solid var(--border);padding:8px 10px;text-align:left}
    .table.mini td{padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
    .table .col-actions{width:110px}
    .rem-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .cardx{border:1px solid var(--border);border-radius:12px;padding:10px}
    .actions-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    @media (max-width:1100px){.kpi-row{grid-template-columns:repeat(2,1fr)}.kpi-row.wide{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
    @media (max-width:820px){.rem-grid{grid-template-columns:1fr}}
    @media (max-width:680px){.kpi-row,.kpi-row.wide{grid-template-columns:1fr}}
  `;
    host.appendChild(style);

    const q = s => host.querySelector(s);
    const fromI = q("#dash-from"), toI = q("#dash-to"), quick = q(".quick"), printBtn = q("#dash-print");
    const kIn = q("#kpi-in"), kAD = q("#kpi-ad"), kOcc = q("#kpi-occ"), kRooms = q("#kpi-rooms"),
        kDue = q("#kpi-due"), kOvr = q("#kpi-ovr"), kRoom = q("#kpi-room"),
        kTR = q("#kpi-trev"), kADR = q("#kpi-adr"), kNGT = q("#kpi-ngt"), kRVP = q("#kpi-rvp"),
        svg = q("#rev-svg"), tcap = q("#trend-cap"),
        dueRows = q("#due-rows"), depRows = q("#dep-rows"), depCap = q("#dep-cap"),
        actRows = q("#act-rows"),
        clock = q("#dash-clock"), clockDate = q("#clock-date");

    // defaults
    const t = today(), mStart = t.slice(0, 8) + "01";
    fromI.value = mStart; toI.value = t;

    fromI.addEventListener("input", render);
    toI.addEventListener("input", render);
    quick.addEventListener("click", e => {
        const b = e.target.closest("button[data-r]"); if (!b) return;
        const r = b.dataset.r;
        if (r === "today") { fromI.value = t; toI.value = t; }
        else if (r === "7d") { fromI.value = isoDaysAgo(6); toI.value = t; }
        else if (r === "mtd") { fromI.value = mStart; toI.value = t; }
        else if (r === "30d") { fromI.value = isoDaysAgo(29); toI.value = t; }
        render();
    });
    printBtn.addEventListener("click", onPrint);

    // clock
    startClock(clock, clockDate);

    const unsub = store.subscribe?.(render) || (() => { });
    host.addEventListener("DOMNodeRemoved", () => unsub?.());

    render();
    return host;

    /* ---------------- render ---------------- */
    function render() {
        const D0 = ensure(getState());
        const D = {
            ...D0,
            orders: [...(D0.orders || []), ...(D0.guests || []).flatMap(g => Array.isArray(g.orders) ? g.orders.map(o => ({ ...o, guestId: o.guestId ?? g.id })) : [])],
            payments: [...(D0.payments || []), ...(D0.guests || []).flatMap(g => Array.isArray(g.payments) ? g.payments.map(p => ({ ...p, guestId: p.guestId ?? g.id, guestName: p.guestName ?? g.name })) : [])],
            expenses: [...(D0.expenses || []), ...(D0.guests || []).flatMap(g => Array.isArray(g.expenses) ? g.expenses : [])]
        };

        let from = fromI.value || t, to = toI.value || t; if (from > to) { const tmp = from; from = to; to = tmp; }
        if (tcap) tcap.textContent = `${from} → ${to}`;

        const capacity = Number(D.settings?.totalRooms) || (Array.isArray(D.rooms) ? D.rooms.length : 0);
        const allGuests = D.guests || [];
        const inhouse = allGuests.filter(g => (g.status || "checked-in") === "checked-in" && !g.checkedOut);
        const arrivalsToday = allGuests.filter(g => g.status === "arrival" && (g.checkInDate || "").slice(0, 10) === t);

        kIn.textContent = String(inhouse.length);
        const departures = inhouse.filter(g => (g.checkOutDate || "").slice(0, 10) === t).length;
        kAD.textContent = `Arrivals ${arrivalsToday.length} • Departures ${departures}`;

        const occRooms = uniqueRooms(inhouse).length;
        kOcc.textContent = capacity ? `${Math.round((occRooms / capacity) * 100)}%` : "—";
        kRooms.textContent = `${occRooms}/${capacity} Rooms`;

        const roomS = roomRevenueSeries(D, from, to);
        const ordS = seriesBy(D.orders, from, to, o => detectISODate(o), o => detectAmount(o));
        const roomRev = sumSeries(roomS); const ordRev = sumSeries(ordS);
        kRoom.textContent = money(roomRev); kTR.textContent = money(roomRev + ordRev);

        // dues + overdue
        let dueSum = 0, over = 0;
        for (const g of inhouse) {
            const paid = (D.payments || []).filter(p => p.guestId === g.id).reduce((s, p) => s + detectAmount(p), 0);
            const ordersAmt = (D.orders || []).filter(o => o.guestId === g.id).reduce((s, o) => s + detectAmount(o), 0);
            const dn = Math.max(1, diffNights(g.checkInDate, t));
            const room = dn * Number(g.roomRent || 0);
            dueSum += round2(room + ordersAmt - paid);
            const co = (g.checkOutDate || "").slice(0, 10); if (co && co < t) over++;
        }
        kDue.textContent = money(dueSum); kOvr.textContent = String(over);

        // ADR / RevPAR
        const nights = (() => {
            let n = 0;
            for (const s of (D.stays || [])) { const a = (s.checkIn || "").slice(0, 10), b = (s.checkOut || "").slice(0, 10); if (!a || !b) continue; n += overlapNights(a, b, from, to); }
            for (const g of inhouse) { const a = (g.checkInDate || "").slice(0, 10); if (!a) continue; const b = ((g.checkOutDate || to)).slice(0, 10); n += overlapNights(a, b, from, to); }
            return n;
        })();
        kNGT.textContent = String(nights);
        kADR.textContent = money(nights > 0 ? roomRev / nights : 0);
        const days = datesBetween(from, to).length; const roomsAvail = (capacity || 0) * days;
        kRVP.textContent = money(roomsAvail > 0 ? roomRev / roomsAvail : 0);

        paintSVG(svg, roomS, ordS);
        paintDues(inhouse, D);
        paintDep(inhouse, D);
        paintAct(D, from, to);
    }

    /* ---------------- painters ---------------- */
    function paintSVG(svgEl, roomSeries, ordSeries) {
        if (!svgEl) return;
        const W = 600, H = 160, pad = 8, w = W - pad * 2, h = H - pad * 2;
        const total = roomSeries.map((r, i) => ({ date: r.date, value: r.value + (ordSeries[i]?.value || 0) }));
        const maxV = Math.max(1, ...roomSeries.map(x => x.value), ...ordSeries.map(x => x.value), ...total.map(x => x.value));
        const n = roomSeries.length || 1;
        const X = i => pad + (n <= 1 ? w / 2 : i * (w / (n - 1)));
        const Y = v => pad + h - (v / maxV) * h;

        // grid (5 horizontal lines)
        let grid = "";
        for (let k = 0; k <= 4; k++) { const y = pad + (h * k / 4); grid += `<line x1="${pad}" y1="${y}" x2="${pad + w}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`; }

        const pathLine = series => series.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.value)}`).join(" ");
        const areaPath = (() => {
            const top = roomSeries.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.value)}`).join(" ");
            const base = `L${pad + w},${pad + h} L${pad},${pad + h} Z`;
            return top + " " + base;
        })();

        const svgHTML = `
      ${grid}
      <!-- total line -->
      <path d="${pathLine(total)}" fill="none" stroke="#111827" stroke-width="2" />
      <!-- room area -->
      <path d="${areaPath}" fill="rgba(52,211,153,.25)" stroke="none"/>
      <!-- orders dashed -->
      <path d="${pathLine(ordSeries)}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4 3"/>
    `;
        svgEl.innerHTML = svgHTML;
    }

    function paintDues(inhouse, D) {
        const tbody = host.querySelector("#due-rows"); if (!tbody) return;
        const list = (inhouse || []).map(g => {
            const paid = (D.payments || []).filter(p => p.guestId === g.id).reduce((s, p) => s + detectAmount(p), 0);
            const ordersAmt = (D.orders || []).filter(o => o.guestId === g.id).reduce((s, o) => s + detectAmount(o), 0);
            const dn = Math.max(1, diffNights(g.checkInDate, today()));
            const room = dn * Number(g.roomRent || 0);
            return { name: g.name || "Guest", room: g.roomNo || "", due: round2(room + ordersAmt - paid) };
        }).filter(x => x.due > 0.001).sort((a, b) => b.due - a.due).slice(0, 5);

        tbody.innerHTML = list.length ? "" : `<tr><td colspan="4" class="muted tc">No dues 🎉</td></tr>`;
        const frag = document.createDocumentFragment();
        for (const x of list) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${esc(x.name)}</td><td>${esc(x.room)}</td><td class="r">${money(x.due)}</td><td class="col-actions"><a class="btn primary xs" href="#/payments">Pay</a></td>`;
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
    }

    function paintDep(inhouse, D) {
        const tbody = host.querySelector("#dep-rows"), cap = host.querySelector("#dep-cap"); if (!tbody) return;
        const tISO = today();
        const list = (inhouse || []).filter(g => (g.checkOutDate || "").slice(0, 10) === tISO)
            .map(g => {
                const paid = (D.payments || []).filter(p => p.guestId === g.id).reduce((s, p) => s + detectAmount(p), 0);
                const ordersAmt = (D.orders || []).filter(o => o.guestId === g.id).reduce((s, o) => s + detectAmount(o), 0);
                const dn = Math.max(1, diffNights(g.checkInDate, tISO));
                const room = dn * Number(g.roomRent || 0);
                const due = round2(room + ordersAmt - paid);
                return { name: g.name || "Guest", room: g.roomNo || "", out: g.checkOutTime || "", due };
            }).sort((a, b) => (b.due - a.due) || String(a.room).localeCompare(String(b.room)));
        cap.textContent = list.length ? `${list.length} due to depart` : "—";
        tbody.innerHTML = list.length ? "" : `<tr><td colspan="5" class="muted tc">No departures</td></tr>`;
        const frag = document.createDocumentFragment();
        for (const x of list) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${esc(x.name)}</td><td>${esc(x.room)}</td><td>${esc(x.out || "-")}</td><td class="r">${money(x.due)}</td><td class="col-actions"><a class="btn primary xs" href="#/checkout">Check&nbsp;Out</a></td>`;
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
    }

    function paintAct(D, from, to) {
        const tbody = host.querySelector("#act-rows"); if (!tbody) return;
        const inRange = iso => iso && iso >= from && iso <= to;
        const p = (D.payments || []).map(p => ({ t: "Payment", date: detectISODate(p), amt: detectAmount(p), ref: p.ref || "", who: p.guestName || "" })).filter(x => inRange(x.date));
        const e = (D.expenses || []).map(x => ({ t: "Expense", date: detectISODate(x), amt: -detectAmount(x), ref: x.ref || "", who: x.category || "" })).filter(x => inRange(x.date));
        const list = p.concat(e).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 10);
        tbody.innerHTML = list.length ? "" : `<tr><td colspan="4" class="muted tc">No activity</td></tr>`;
        const frag = document.createDocumentFragment();
        for (const x of list) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${esc((x.date || "").slice(0, 10))}</td><td>${esc(x.t)}</td><td>${esc(x.t === "Payment" ? (x.who || x.ref || "") : (x.who || x.ref || ""))}</td><td class="r">${x.t === "Payment" ? money(x.amt) : `<span style="color:#dc2626">-${money(Math.abs(x.amt))}</span>`}</td>`;
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
    }

    /* clock */
    function startClock(root, dateEl) {
        if (!root) return;
        const h = root.querySelector(".h"), m = root.querySelector(".m"), s = root.querySelector(".s"), apEl = root.querySelector(".ampm");
        const tick = () => {
            const d = new Date(); let hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds(); const ap = hh >= 12 ? "PM" : "AM"; hh = hh % 12; if (hh === 0) hh = 12;
            const pad = x => String(x).padStart(2, "0"); h.textContent = pad(hh); m.textContent = pad(mm); s.textContent = pad(ss); apEl.textContent = ap;
            if (dateEl) dateEl.textContent = d.toLocaleDateString();
        };
        tick(); const id = setInterval(tick, 1000); host.addEventListener("DOMNodeRemoved", () => clearInterval(id));
    }

    /* print */
    function onPrint() {
        const D = ensure(getState());
        let from = fromI.value || t, to = toI.value || t; if (from > to) { const tmp = from; from = to; to = tmp; }
        const S = D.settings || {}, hotel = S.hotelName || "Hotel Front Desk", logo = S.logo || "";
        const roomS = roomRevenueSeries(D, from, to);
        const ordS = seriesBy(D.orders || [], from, to, o => detectISODate(o), o => detectAmount(o));
        const sum = s => s.reduce((a, b) => a + Number(b.value || 0), 0);

        const html = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">
        ${logo ? `<img src="${logo}" style="width:48px;height:48px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px;background:#fff"/>` : ""}
        <div><div style="font-weight:800">${esc(hotel)}</div><div style="color:#6b7280">Dashboard Summary • ${esc(from)} → ${esc(to)}</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tbody>
          <tr><th style="text-align:left;padding:6px;border-top:1px solid #e5e7eb">Room Revenue</th><td style="text-align:right;padding:6px;border-top:1px solid #e5e7eb">${money(sum(roomS))}</td></tr>
          <tr><th style="text-align:left;padding:6px;border-top:1px solid #e5e7eb">Orders Revenue</th><td style="text-align:right;padding:6px;border-top:1px solid #e5e7eb">${money(sum(ordS))}</td></tr>
        </tbody>
      </table>
      <script>window.print()</script>
    `;
        const w = window.open("", "_blank"); if (!w) return;
        w.document.write(`<html><head><meta charset="utf-8"><title>Dashboard Summary</title></head><body style="font-family:system-ui,Segoe UI,Roboto,Arial">${html}</body></html>`);
        w.document.close();
    }
}
