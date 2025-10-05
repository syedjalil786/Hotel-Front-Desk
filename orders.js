// tabs/orders.js — Orders with "Other…" item + Print Selected Guest Orders
// Faster: optimistic UI update, double-click guard, instant flush.

import { store } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
));
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime  = () => new Date().toTimeString().slice(0,5);
const uid = () => Math.random().toString(36).slice(2, 10);

/* money for print (no decimals — matches your receipts/invoices) */
function money0(n){
  try{
    const S = (getS().settings)||{};
    const code = S.currency || "PKR";
    const label = S.currencyLabel || "Rs";
    const loc = S.locale || "en-PK";
    const nf = new Intl.NumberFormat(loc,{style:"currency",currency:code,maximumFractionDigits:0,minimumFractionDigits:0});
    let out = nf.format(Number(n||0));
    const sym = nf.formatToParts(1).find(p=>p.type==="currency")?.value || "";
    return sym ? out.replace(sym, label) : `${label} ${Math.round(Number(n||0))}`;
  }catch{ return "Rs " + Math.round(Number(n||0)); }
}

/* state utils */
function ensure(d) {
  const n = d ? { ...d } : {};
  for (const k of ["guests","orders","payments","expenses","stays","rooms"]) {
    if (!Array.isArray(n[k])) n[k] = [];
  }
  n.settings ||= {};
  return n;
}
function getS() {
  try { if (typeof store?.get === "function") return store.get(); } catch {}
  return (window.__APP_STATE__ || {});
}
function save(updater) {
  if (typeof store?.update === "function") {
    store.update(prev => updater(ensure(prev))); return;
  }
  const next = updater(ensure(getS()));
  if (typeof store?.set === "function") store.set(next);
  else if (typeof store?.setState === "function") store.setState(next);
  else window.__APP_STATE__ = next;
}

/* ---------------- print layout (brand header from settings) ---------------- */
function baseCSS(){
  return `
  <style>
    :root{--ink:#111;--muted:#6b7280;--border:#d1d5db;--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial}
    @page{size:A4;margin:0}
    html,body{height:100%}
    body{margin:0;background:#fff;color:var(--ink);font-family:var(--font);-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:12mm;display:flex;flex-direction:column;gap:8mm}
    .topband{background:#f3f4f6;padding:12px;border-radius:8px}
    .brand{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .brand-lines{flex:1;min-width:0}
    .brand-name{font-weight:700;font-size:18px}
    .brand-sub{font-size:12px;color:var(--muted)}
    .brand-logo{display:flex;align-items:center;height:56px;max-width:260px}
    .brand-logo img{height:100%;width:auto;object-fit:contain}
    .logo-fallback{height:100%;width:100%;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);background:#f3f4f6;color:#6b7280;font-size:12px}
    .docrow{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:8px}
    .doctitle{font-size:26px;margin:0}
    .docmeta{text-align:right;font-size:12px}
    .roomline{margin-top:6px;border-bottom:1px solid var(--border);padding-bottom:6px;color:#6b7280}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}
    .card{border:1px solid var(--border);border-radius:8px;padding:8px}
    .ttl{font-weight:700;color:#111}
    .muted{color:#6b7280}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
    th,td{border:1px solid var(--border);padding:8px 10px;vertical-align:top;text-align:left}
    thead th{background:#f8fafc}
    .r{text-align:right}
    tfoot th{background:#fafafa}
    .fine{margin-top:8px;font-size:11px;color:#6b7280}
  </style>`;
}
function renderTop(css, title, data){
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>${css}</head><body>
  <section class="sheet">
    <header class="topband">
      <div class="brand">
        <div class="brand-lines">
          <div class="brand-name">${esc(data.hotelName || "Hotel")}</div>
          <div class="brand-sub">${esc(data.hotelAddress || "")}</div>
          <div class="brand-sub">${esc(data.hotelContact || "")}</div>
        </div>
        <div class="brand-logo">
          ${data.logo ? `<img src="${esc(data.logo)}" alt="Logo">` : `<div class="logo-fallback">LOGO</div>`}
        </div>
      </div>
    </header>`;
}

/* ---------------- view ---------------- */
export default async function view() {
  const host = document.createElement("section");
  host.className = "card";
  host.setAttribute("data-view", "orders");

  host.innerHTML = `
  <header class="view-header">
    <h2>Orders</h2>
  </header>

  <div class="toolbar">
    <div class="control range">
      <label>Date</label>
      <div class="range-fields">
        <input type="date" id="f-from" class="input sm">
        <span class="range-sep">to</span>
        <input type="date" id="f-to" class="input sm">
      </div>
    </div>

    <div class="control grow">
      <label>Search</label>
      <input id="f-q" class="input sm" placeholder="Search guest / room / item">
    </div>

    <div class="control actions">
      <button id="btn-export" class="btn">Export CSV</button>
    </div>
  </div>

  <section class="panel" id="order-form">
    <div class="panel-head">
      <h3>Add Order</h3>
    </div>
    <div class="form-grid-3">
      <div class="fi">
        <label>Guest</label>
        <select id="gSel" class="input"></select>
      </div>
      <div class="fi">
        <label>Item</label>
        <select id="item" class="input">
          <option>Water</option><option>Tea</option><option>Breakfast</option>
          <option>Laundry</option><option>Lunch</option><option>Dinner</option>
          <option value="__other__">Other…</option>
        </select>
      </div>
      <div class="fi" id="fi-item-other" style="display:none;">
        <label>Custom Item</label>
        <input id="item-other" class="input" placeholder="Enter custom item">
      </div>
      <div class="fi">
        <label>Amount</label>
        <input id="amount" type="number" class="input" min="0" step="1" placeholder="0">
      </div>
      <div class="fi">
        <label>Date</label>
        <input id="date" type="date" class="input">
      </div>
      <div class="fi">
        <label>Time</label>
        <input id="time" type="time" class="input">
      </div>
      <div class="fi full">
        <label>Note</label>
        <input id="note" class="input" placeholder="Optional note">
      </div>
      <div class="fi full" style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="btn-save" class="btn primary">Save Order</button>
        <button id="btn-clear" class="btn ghost">Clear</button>
        <button id="btn-print-guest" class="btn">Print Selected Guest Orders</button>
      </div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h3>Orders List</h3>
      <div class="muted" id="sum-cap">—</div>
    </div>
    <div class="table-wrap">
      <table class="table mini">
        <thead>
          <tr>
            <th>Date</th><th>Guest</th><th>Room</th><th>Item</th>
            <th class="r">Amount</th><th>Note</th><th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr><td colspan="7" class="tc muted">No orders</td></tr>
        </tbody>
      </table>
    </div>
  </section>
  `;

  const style = document.createElement("style");
  style.textContent = `
  [data-view="orders"] .panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
  .panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .table.mini th,.table.mini td{padding:8px 10px}
  .r{text-align:right}
  .fi label{font-weight:600}
  `;
  host.appendChild(style);

  /* refs */
  const qs = (s) => host.querySelector(s);
  const fromI = qs("#f-from"), toI = qs("#f-to"), qI = qs("#f-q");
  const exportBtn = qs("#btn-export");
  const gSel = qs("#gSel"), itemI = qs("#item"), itemOtherWrap = qs("#fi-item-other"), itemOtherI = qs("#item-other");
  const amountI = qs("#amount"), noteI = qs("#note"), dateI = qs("#date"), timeI = qs("#time");
  const saveBtn = qs("#btn-save"), clearBtn = qs("#btn-clear");
  const printGuestBtn = qs("#btn-print-guest");
  const rows = qs("#rows"), sumCap = qs("#sum-cap");

  const t = todayISO(); fromI.value = t; toI.value = t; dateI.value = t; timeI.value = nowTime();

  function toggleOther() {
    const isOther = itemI.value === "__other__";
    itemOtherWrap.style.display = isOther ? "" : "none";
    if (!isOther) itemOtherI.value = "";
  }
  itemI.addEventListener("change", toggleOther);

  function refreshGuests() {
    const D = ensure(getS());
    // ✅ Only show currently checked-in guests (hide arrivals & checked-out)
    const guests = (D.guests || [])
      .filter(g => String(g.status || "").toLowerCase() === "checked-in" && !g.checkedOut)
      .sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    gSel.innerHTML = `<option value="">— Select Guest —</option>` + guests.map(g =>
      `<option value="${esc(g.id)}">${esc(g.name || "Guest")} — Room ${esc(g.roomNo || "?")}</option>`).join("");
  }
  refreshGuests();

  /* events */
  [fromI, toI, qI].forEach(el => el.addEventListener("input", () => renderTable()));
  exportBtn.addEventListener("click", exportCSV);

  let busy = false; // double-click guard
  saveBtn.addEventListener("click", onSave);
  clearBtn.addEventListener("click", clearForm);
  printGuestBtn.addEventListener("click", onPrintSelectedGuest);

  const unsub = store.subscribe?.(() => { refreshGuests(); renderTable(); });
  host.addEventListener("DOMNodeRemoved", () => unsub?.());

  renderTable();
  return host;

  /* ---------- logic ---------- */
  function onSave() {
    if (busy) return;
    const D = ensure(getS());
    const gid = gSel.value; const guest = (D.guests || []).find(x => String(x.id) === String(gid));
    if (!guest) { alert("Select guest"); return; }
    const amt = Number(amountI.value || 0); if (!(amt > 0)) { alert("Enter amount"); return; }
    const itemName = (itemI.value === "__other__") ? (itemOtherI.value.trim() || "Other") : itemI.value;

    const order = {
      id: uid(),
      guestId: guest.id,
      guestName: guest.name || "Guest",
      roomNo: guest.roomNo || "",
      item: itemName,
      amount: Math.round(amt),
      note: noteI.value || "",
      date: dateI.value || t,
      time: timeI.value || nowTime()
    };

    busy = true; saveBtn.disabled = true;

    // 1) Commit to store (sync in-memory) 
    save(prev => { const n = ensure(prev); n.orders = [order, ...(n.orders || [])]; return n; });

    // 2) Optimistic UI render (works even if store.get() lags)
    const from = fromI.value || "0000-01-01";
    const to = toI.value || "9999-12-31";
    const qv = (qI.value || "").toLowerCase();
    const d = (order.date || "").slice(0,10);
    const pass = !(d < from || d > to) && (!qv || `${order.guestName} ${order.roomNo} ${order.item}`.toLowerCase().includes(qv));
    if (pass) {
      const Dnow = ensure(getS());
      const current = listFiltered(Dnow);
      renderTable([order, ...current]);
    } else {
      renderTable();
    }

    // 3) Try to flush to backend immediately (if wired)
    try { store.flushNow?.(); } catch {}

    // 4) Clear form; small re-render once store settles
    clearForm();
    setTimeout(() => renderTable(), 40);

    // 5) Release button quickly
    setTimeout(() => { busy = false; saveBtn.disabled = false; }, 80);
  }

  function clearForm() {
    gSel.value = ""; itemI.value = "Water"; toggleOther(); if (itemOtherI) itemOtherI.value = "";
    amountI.value = ""; noteI.value = ""; dateI.value = t; timeI.value = nowTime();
  }

  function listFiltered(D) {
    const from = fromI.value || "0000-01-01", to = toI.value || "9999-12-31", qv = (qI.value || "").toLowerCase();
    return (D.orders || []).filter(o => {
      const d = (o.date || "").slice(0,10);
      if (d < from || d > to) return false;
      if (qv && !`${o.guestName} ${o.roomNo} ${o.item}`.toLowerCase().includes(qv)) return false;
      return true;
    });
  }

  function renderTable(forcedList) {
    const D = ensure(getS());
    const list = forcedList || listFiltered(D);
    rows.innerHTML = "";
    if (!list.length) { rows.innerHTML = `<tr><td colspan="7" class="tc muted">No orders</td></tr>`; return; }

    const frag = document.createDocumentFragment();
    let sum = 0;
    for (const o of list) {
      sum += Number(o.amount || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(o.date || "")} ${esc(o.time || "")}</td>
        <td>${esc(o.guestName || "")}</td>
        <td>${esc(o.roomNo || "")}</td>
        <td>${esc(o.item || "")}</td>
        <td class="r">${Math.round(Number(o.amount || 0))}</td>
        <td>${esc(o.note || "")}</td>
        <td class="col-actions">
          <button class="btn xs danger" data-id="${esc(o.id)}">Delete</button>
        </td>`;
      tr.querySelector("button[data-id]").addEventListener("click", () => {
        if (!confirm("Delete this order? This cannot be undone.")) return;
        save(prev => { const n = ensure(prev); n.orders = (n.orders || []).filter(x => x.id !== o.id); return n; });
        // instant refresh + optional backend flush
        renderTable();
        try { store.flushNow?.(); } catch {}
      });
      frag.appendChild(tr);
    }
    rows.appendChild(frag);
    sumCap.textContent = `${list.length} order${list.length !== 1 ? "s" : ""} • Total ${Math.round(sum)}`;
  }

  function exportCSV() {
    const D = ensure(getS());
    const list = listFiltered(D);
    const header = ["Date","Time","Guest","Room","Item","Amount","Note","ID"];
    const rowsCSV = list.map(o => [
      o.date || "", o.time || "", o.guestName || "", o.roomNo || "", o.item || "",
      Math.round(Number(o.amount || 0)).toString(), (o.note || "").replace(/\n/g," "), o.id || ""
    ].map(v => /[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v)).join(","));
    const a = document.createElement("a");
    a.download = `orders_${(fromI.value || "from")}_to_${(toI.value || "to")}.csv`;
    a.href = URL.createObjectURL(new Blob([header.join(",") + "\n" + rowsCSV.join("\n")], { type: "text/csv" }));
    a.click();
  }

  /* ---------------- print selected guest orders ---------------- */
  function onPrintSelectedGuest(){
    const D = ensure(getS());
    const gid = gSel.value;
    if (!gid){ alert("Select a guest first (top of Add Order form)."); return; }
    const guest = (D.guests || []).find(g => String(g.id) === String(gid));
    if (!guest){ alert("Guest not found"); return; }

    const list = (D.orders || []).filter(o => String(o.guestId) === String(gid))
      .sort((a,b) => `${a.date||""} ${a.time||""}`.localeCompare(`${b.date||""} ${b.time||""}`));

    const S = D.settings || {};
    const data = {
      hotelName: S.hotelName || "Hotel",
      hotelAddress: S.address || "",
      hotelContact: S.phone || "",
      logo: S.logo || ""
    };

    const css = baseCSS();
    const top = renderTop(css, "Guest Orders", data);

    const total = list.reduce((s,o)=> s + Number(o.amount||0), 0);

    // Show Check-In and Check-Out on separate lines
    const stayLines = [];
    if (guest.checkInDate) {
      stayLines.push(`<div>Check-In: ${esc((guest.checkInDate||"").slice(0,10))} ${esc(guest.checkInTime||"")}</div>`);
    }
    if (guest.checkOutDate) {
      stayLines.push(`<div>Check-Out: ${esc((guest.checkOutDate||"").slice(0,10))} ${esc(guest.checkOutTime||"")}</div>`);
    }
    const stayBlock = stayLines.length ? stayLines.join("") : `<div class="muted">—</div>`;

    const html = `
      ${top}
      <div class="docrow">
        <h1 class="doctitle">GUEST ORDERS</h1>
        <div class="docmeta"><div><span class="muted">Printed:</span> ${todayISO()} ${nowTime()}</div></div>
      </div>

      <div class="roomline">ROOM <strong> ${esc(guest.roomNo || "-")} </strong></div>

      <div class="grid">
        <div class="card">
          <div class="ttl">Guest</div>
          <div>${esc(guest.name || "Guest")}</div>
          <div class="muted">${esc(guest.address || "")}</div>
          <div class="muted">${esc(guest.mobile || "")}</div>
        </div>
        <div class="card">
          <div class="ttl">Stay</div>
          ${stayBlock}
        </div>
      </div>

      <table style="margin-top:10px">
        <thead>
          <tr><th style="width:22%">DATE / TIME</th><th style="width:28%">ITEM</th><th>NOTE</th><th class="r" style="width:16%">AMOUNT</th></tr>
        </thead>
        <tbody>
          ${list.length ? list.map(o => `
            <tr>
              <td>${esc((o.date||"").slice(0,10))} ${esc(o.time||"")}</td>
              <td>${esc(o.item||"")}</td>
              <td>${esc(o.note||"")}</td>
              <td class="r">${money0(o.amount||0)}</td>
            </tr>
          `).join("") : `<tr><td colspan="4">No orders for this guest.</td></tr>`}
        </tbody>
        <tfoot>
          <tr><th colspan="3" class="r">TOTAL</th><th class="r">${money0(total)}</th></tr>
        </tfoot>
      </table>

      <div class="fine">This list shows all recorded orders for the selected guest.</div>
    </section>
    </body></html>`;

    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(html); w.document.close();
  }
}
