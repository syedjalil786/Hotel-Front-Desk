// tabs/checkout.js — checkout with highlighted summary, soft UI, custom items + quick payment
// Uses the SAME invoice template as payments.js for printing. (Dates in invoice = DD-MM-YYYY and wrapped in brackets)
import { store } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const uid = () => Math.random().toString(36).slice(2, 10);
const round2 = n => Math.round(Number(n || 0) * 100) / 100;

/* ---- date helpers (DD-MM-YYYY) ---- */
const pad2 = n => String(n).padStart(2, "0");
function fmtDateDDMY(iso) {
  if (!iso) return "";
  const d = new Date((String(iso).slice(0,10)) + "T00:00:00");
  if (isNaN(d)) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()}`;
}

function getState(){ try{ if(typeof store?.get==="function") return store.get(); }catch{} return (window.__APP_STATE__||{}); }
function ensure(d){
  const n = d ? { ...d } : {};
  for(const k of ["guests","orders","payments","expenses","stays","rooms","customItems"]) if(!Array.isArray(n[k])) n[k]=[];
  n.settings ||= {};
  return n;
}
function save(updater){
  if (typeof store?.update === "function"){ store.update(prev=>updater(ensure(prev))); return; }
  const curr = ensure(getState()); const next = updater(curr);
  if (typeof store?.set === "function") store.set(next);
  else if (typeof store?.setState === "function") store.setState(next);
  else window.__APP_STATE__ = next;
}

/* Money for UI (2 decimals, unchanged) */
function money(n){
  try{
    const S = (getState().settings)||{};
    const code = S.currency||"PKR", label = S.currencyLabel||"Rs", loc = S.locale||"en-PK";
    const nf = new Intl.NumberFormat(loc,{ style:"currency", currency:code, maximumFractionDigits:2 });
    let out = nf.format(Number(n||0));
    const sym = nf.formatToParts(1).find(p=>p.type==="currency")?.value || "";
    return sym ? out.replace(sym, label) : `Rs ${Number(n||0).toFixed(2)}`;
  }catch{ return "Rs " + Number(n||0).toFixed(2); }
}

/* Money for INVOICE (no decimals — exactly like payments.js) */
function invMoney(n){
  try{
    const S = (getState().settings)||{};
    const code = S.currency||"PKR";
    const label = S.currencyLabel||"Rs";
    const loc = S.locale||"en-PK";
    const nf = new Intl.NumberFormat(loc,{ style:"currency", currency:code, maximumFractionDigits:0, minimumFractionDigits:0 });
    let out = nf.format(Number(n||0));
    const sym = nf.formatToParts(1).find(p=>p.type==="currency")?.value || "";
    return sym ? out.replace(sym, label) : `${label} ${Math.round(Number(n||0))}`;
  }catch{ return "Rs " + Math.round(Number(n||0)); }
}

function diffNights(aISO,bISO){
  if(!aISO||!bISO) return 0;
  const a = new Date(aISO+"T00:00:00"), b = new Date(bISO+"T00:00:00");
  return Math.max(0, Math.floor((b-a)/86400000));
}
const STATUS_INHOUSE = new Set(["checked-in","arrival"]);
const isInHouse = g => STATUS_INHOUSE.has(String(g.status||"checked-in").toLowerCase()) && !g.checkedOut;

/* ---------------- main view ---------------- */
export default async function view(){
  const host = document.createElement("section");
  host.className = "card";
  host.setAttribute("data-view","checkout");

  host.innerHTML = `
  <header class="view-header">
    <h2>Check Out</h2>
    <div class="filters"><label class="muted">Pick guest to manage invoice</label></div>
  </header>

  <section class="panel" id="editor">
    <div class="panel-head">
      <h3>Invoice Editor</h3>
      <span class="muted" id="edit-cap">—</span>
    </div>

    <!-- Summary -->
    <div class="summary">
      <div class="summary-left">
        <div class="guest-line">
          <span class="emoji">👤</span>
          <strong id="sum-guest">—</strong>
          <span class="room-pill" id="sum-room">Room —</span>
        </div>
      </div>
      <div class="summary-right">
        <div class="chip"><span>🗓 Check-In</span><strong id="sum-in">—</strong></div>
        <div class="chip"><span>🏁 Check-Out</span><strong id="sum-out">—</strong></div>
        <div class="chip"><span>📞 Mobile</span><strong id="sum-mobile">—</strong></div>
        <div class="chip"><span>🌙 Nights</span><strong id="sum-nights">0</strong></div>
      </div>
    </div>

    <div class="form-grid-2">
      <div class="fi hi">
        <label>Guest</label>
        <select id="co-guest" class="input"></select>
      </div>
      <div class="fi hi">
        <label>Room</label>
        <input id="co-room" class="input" readonly>
      </div>

      <div class="fi hi">
        <label>Check-In</label>
        <input id="co-in" type="date" class="input">
      </div>
      <div class="fi hi">
        <label>Mobile</label>
        <input id="co-mobile" class="input" readonly>
      </div>

      <div class="fi">
        <label>Half-Night</label>
        <input id="co-half" type="checkbox" class="flip">
      </div>
      <div class="fi">
        <label>Room Rent / Night</label>
        <input id="co-rate" class="input" type="number" step="0.01" min="0">
      </div>

      <div class="fi">
        <label>Check-Out</label>
        <input id="co-out" type="date" class="input">
      </div>
      <div class="fi">
        <label>Discount (%)</label>
        <input id="co-discp" class="input" type="number" step="0.01" min="0" max="100">
      </div>

      <div class="fi full">
        <label>Discount (Rs)</label>
        <input id="co-discr" class="input" type="number" step="0.01" min="0">
      </div>
    </div>

    <div class="grid-2x">
      <section class="subpanel">
        <div class="subhead">
          <h4>Orders</h4>
          <span class="muted">(check to include)</span>
        </div>
        <div class="table-wrap">
          <table class="table mini">
            <thead><tr><th>Include</th><th>Date</th><th>Item</th><th class="r">Amount</th><th>Note</th><th class="col-del">Del</th></tr></thead>
            <tbody id="co-orders"><tr><td colspan="6" class="tc muted">No orders</td></tr></tbody>
          </table>
        </div>

        <div class="subhead" style="margin-top:10px">
          <h4>Custom Items</h4>
          <span class="muted">(charges + credits, check to include)</span>
        </div>
        <div class="table-wrap">
          <table class="table mini">
            <thead><tr><th>Include</th><th>Date</th><th>Description</th><th class="r">Amount</th><th>Note</th><th class="col-del">Del</th></tr></thead>
            <tbody id="co-custom"><tr><td colspan="6" class="tc muted">No items</td></tr></tbody>
          </table>
        </div>

        <div class="quickcustom">
          <div class="quick-grid2">
            <input id="ci-desc" class="input" placeholder="Description (e.g., Minibar, Late out)">
            <input id="ci-amt" class="input" placeholder="Amount (e.g., 500 or -200)">
            <input id="ci-note" class="input" placeholder="Note (optional)">
            <button class="btn" id="ci-add">Add Item</button>
          </div>
          <div class="muted">Positive = charge; negative = credit/waiver</div>
        </div>
      </section>

      <section class="subpanel">
        <div class="subhead"><h4>Payments</h4><span class="muted">(check to include)</span></div>
        <div class="table-wrap">
          <table class="table mini">
            <thead><tr><th>Include</th><th>Date</th><th>Method</th><th class="r">Amount</th><th>Ref</th><th class="col-del">Del</th></tr></thead>
            <tbody id="co-pays"><tr><td colspan="6" class="tc muted">No payments</td></tr></tbody>
          </table>
        </div>

        <div class="quickpay">
          <h5>Add Payment</h5>
          <div class="quick-grid">
            <input id="qp-amt" class="input" placeholder="Amount">
            <select id="qp-met" class="input">
              <option>Cash</option><option>Card</option><option>Bank</option><option>Online</option>
            </select>
            <input id="qp-date" type="date" class="input">
            <input id="qp-time" type="time" class="input">
            <input id="qp-ref" class="input" placeholder="Ref / Txn #">
            <input id="qp-note" class="input" placeholder="Notes (optional)">
            <button class="btn primary" id="qp-add">Add Payment</button>
          </div>
          <div class="muted" id="qp-cap">Posting payment for: —</div>
        </div>
      </section>
    </div>

    <div class="totals-bar">
      <div>Room: <strong id="t-room">Rs 0.00</strong></div>
      <div>Orders: <strong id="t-ord">Rs 0.00</strong></div>
      <div>Extras: <strong id="t-extras">Rs 0.00</strong></div>
      <div>Subtotal: <strong id="t-sub">Rs 0.00</strong></div>
      <div>Discount: <strong id="t-disc">- Rs 0.00</strong></div>
      <div>Paid: <strong id="t-paid">Rs 0.00</strong></div>
      <div>Grand: <strong id="t-grand">Rs 0.00</strong></div>
      <div>Due: <strong id="t-due" class="red">Rs 0.00</strong></div>
    </div>

    <div class="actions-bar">
      <button class="btn" id="btn-proforma">Print Proforma</button>
      <button class="btn warn" id="btn-direct">Direct Checkout</button>
      <button class="btn primary" id="btn-withdues">Checkout with Dues</button>
    </div>
  </section>
  `;

  /* styles */
  const style = document.createElement("style");
  style.textContent = `
  [data-view="checkout"]{
    --border:#e6e9ef; --muted:#717a8a; --shadow:0 10px 30px rgba(2,8,23,.06),0 2px 8px rgba(2,8,23,.06);
    --tint:#f6f8fb; --ink:#0f172a; --pill:#eef2ff; --pill-border:#c7d2fe;
  }
  .panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
  .panel-head{display:flex;justify-content:space-between;align-items:center}
  .summary{
    position:sticky; top:64px; z-index:5;
    display:flex; justify-content:space-between; align-items:center; gap:10px;
    background:var(--tint); border:1px solid var(--border); border-radius:12px; padding:10px 12px; box-shadow:var(--shadow); margin:10px 0;
  }
  .guest-line{display:flex;align-items:center;gap:10px}
  .guest-line strong{font-size:18px;color:var(--ink)}
  .room-pill{background:var(--pill);border:1px solid var(--pill-border);padding:4px 10px;border-radius:999px;font-weight:700}
  .summary-right{display:flex;flex-wrap:wrap;gap:8px}
  .chip{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:5px 10px}
  .chip span{font-size:12px;color:var(--muted)} .chip strong{font-weight:800}
  .emoji{font-size:20px}
  .form-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .fi.full{grid-column:1/-1}
  .input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f9fafb}
  .fi.hi label{font-weight:800}
  .fi.hi .input{background:#f8fafc;border-color:#dbeafe;box-shadow:inset 0 0 0 1px #eff6ff}
  .grid-2x{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .subpanel{border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff}
  .subhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .table.mini thead th{background:#f8fafc;border-bottom:1px solid var(--border);padding:8px 10px;text-align:left}
  .table.mini td{padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
  .table .col-del{width:50px;text-align:center}
  .r{text-align:right}.red{color:#dc2626}.muted{color:var(--muted)}.tc{text-align:center}
  .quickpay{margin-top:10px}
  .quick-grid{display:grid;grid-template-columns:120px 1fr 150px 120px 1fr 1fr 160px;gap:8px}
  .quickcustom{margin-top:8px}
  .quick-grid2{display:grid;grid-template-columns:1.6fr 1fr 1.6fr 140px;gap:8px}
  .btn{height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
  .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .btn.warn{background:#f59e0b;border-color:#d97706;color:#111827;font-weight:800}
  .actions-bar{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .totals-bar{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:12px}
  @media (max-width:980px){
    .form-grid-2{grid-template-columns:1fr}
    .grid-2x{grid-template-columns:1fr}
    .quick-grid{grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr 160px}
    .quick-grid2{grid-template-columns:1fr 1fr 1fr 140px}
    .summary{top:58px; flex-direction:column; align-items:flex-start}
  }
  `;
  host.appendChild(style);

  /* ------- refs ------- */
  const qs = s => host.querySelector(s);
  const selGuest = qs("#co-guest");
  const editCap = qs("#edit-cap");

  const roomI = qs("#co-room"), mobileI = qs("#co-mobile");
  const inI = qs("#co-in"), outI = qs("#co-out"), rateI = qs("#co-rate");
  const halfI = qs("#co-half"), discPI = qs("#co-discp"), discRI = qs("#co-discr");

  const ordersT = qs("#co-orders"), paysT = qs("#co-pays"), customT = qs("#co-custom");

  const tRoom = qs("#t-room"), tOrd = qs("#t-ord"), tExtras = qs("#t-extras"),
        tSub = qs("#t-sub"), tDisc = qs("#t-disc"), tPaid = qs("#t-paid"),
        tGrand = qs("#t-grand"), tDue = qs("#t-due");

  const btnPF = qs("#btn-proforma"), btnDirect = qs("#btn-direct"), btnWithDues = qs("#btn-withdues");

  // quick payment
  const qpAmt = qs("#qp-amt"), qpMet = qs("#qp-met"), qpDate = qs("#qp-date"),
        qpTime = qs("#qp-time"), qpRef = qs("#qp-ref"), qpNote = qs("#qp-note"),
        qpAdd = qs("#qp-add"), qpCap = qs("#qp-cap");

  // summary refs
  const sumGuest = qs("#sum-guest"), sumRoom = qs("#sum-room"),
        sumIn = qs("#sum-in"), sumOut = qs("#sum-out"),
        sumMobile = qs("#sum-mobile"), sumNights = qs("#sum-nights");

  // custom items quick add
  const ciDesc = qs("#ci-desc"), ciAmt = qs("#ci-amt"), ciNote = qs("#ci-note"), ciAdd = qs("#ci-add");

  /* ------- state ------- */
  let currentId = null;
  qpDate.value = todayISO(); qpTime.value = nowTime();

  /* ------- events ------- */
  selGuest.addEventListener("change", () => loadGuest(selGuest.value));
  [inI, outI, rateI, halfI, discPI, discRI].forEach(el => el.addEventListener("input", () => { recomputeTotals(); updateSummary(); }));

  qpAdd.addEventListener("click", onQuickPay);
  ciAdd.addEventListener("click", onAddCustom);

  btnPF.addEventListener("click", () => printInvoice());          // <— same template as payments.js
  btnDirect.addEventListener("click", () => checkout({ allowDues: false }));
  btnWithDues.addEventListener("click", () => checkout({ allowDues: true }));

  const unsub = store.subscribe?.(() => populateGuestSelect(true));
  host.addEventListener("DOMNodeRemoved", () => unsub?.());

  // first render
  populateGuestSelect();
  return host;

  /* ------- functions ------- */

  function populateGuestSelect(keepSelected=false){
    const D = ensure(getState());
    const list = (D.guests||[]).filter(isInHouse)
      .sort((a,b)=> String(a.roomNo||"").localeCompare(String(b.roomNo||"")) || (a.name||"").localeCompare(b.name||""));
    const prev = keepSelected ? selGuest.value : "";
    selGuest.innerHTML = `<option value="">— Select in-house guest —</option>` +
      list.map(g => `<option value="${esc(g.id)}">${esc(g.name || "Guest")} — Room ${esc(g.roomNo || "?")}</option>`).join("");
    if (prev && list.find(x => String(x.id)===String(prev))) selGuest.value = prev;
    else selGuest.value = list[0]?.id || "";
    loadGuest(selGuest.value);
  }

  function calcNights(ci, co, half=false){
    let n = Math.max(1, diffNights(ci, co)); // same-day => 1 night
    if (half) n = Math.max(0.5, n - 0.5);
    return n;
  }

  function updateSummary(){
    const D = ensure(getState());
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId));
    if (!g){
      sumGuest.textContent = "—"; sumRoom.textContent = "Room —";
      sumIn.textContent = sumOut.textContent = sumMobile.textContent = "—";
      sumNights.textContent = "0";
      return;
    }
    sumGuest.textContent = g.name || "Guest";
    sumRoom.textContent = `Room ${g.roomNo || "-"}`;
    sumIn.textContent = (inI.value || g.checkInDate || todayISO()).slice(0,10);
    sumOut.textContent = (outI.value || g.checkOutDate || todayISO()).slice(0,10);
    sumMobile.textContent = g.mobile || "—";
    sumNights.textContent = String(calcNights(inI.value || g.checkInDate || todayISO(), outI.value || g.checkOutDate || todayISO(), halfI.checked));
  }

  function loadGuest(id){
    const D = ensure(getState());
    const g = (D.guests||[]).find(x => String(x.id)===String(id));
    currentId = g?.id || null;

    ordersT.innerHTML = `<tr><td colspan="6" class="tc muted">No orders</td></tr>`;
    paysT.innerHTML = `<tr><td colspan="6" class="tc muted">No payments</td></tr>`;
    customT.innerHTML = `<tr><td colspan="6" class="tc muted">No items</td></tr>`;

    if (!g){
      editCap.textContent = "—";
      roomI.value = mobileI.value = ""; inI.value = outI.value = todayISO(); rateI.value = ""; halfI.checked = false;
      qpCap.textContent = "Posting payment for: —";
      recomputeTotals();
      updateSummary();
      return;
    }

    editCap.textContent = `Editing • ${g.name || "Guest"} (Room ${g.roomNo || "?"})`;
    qpCap.textContent = `Posting payment for: ${g.name || "Guest"} • Room ${g.roomNo || "?"}`;

    // set fields
    roomI.value = g.roomNo || "";
    mobileI.value = g.mobile || "";
    inI.value = (g.checkInDate || todayISO()).slice(0,10);
    outI.value = (g.checkOutDate || todayISO()).slice(0,10);
    rateI.value = Number(g.roomRent || 0);
    halfI.checked = Boolean(g.halfNight || false);
    discPI.value = Number(g.discountP || 0);
    discRI.value = Number(g.discountR || 0);

    paintOrders(D, g);
    paintCustom(D, g);
    paintPayments(D, g);
    recomputeTotals();
    updateSummary();
  }

  function paintOrders(D, g){
    const gid = g.id;
    const list = (D.orders||[]).filter(o => o.guestId===gid)
      .sort((a,b)=> (a.date||"").localeCompare(b.date||""));
    if (!list.length){ ordersT.innerHTML = `<tr><td colspan="6" class="tc muted">No orders</td></tr>`; return; }
    ordersT.innerHTML = "";
    for (const o of list){
      const d = (o.date||"").slice(0,10);
      const tm = (o.date||"").slice(11,16);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-inc="order" data-id="${esc(o.id)}" checked></td>
        <td>${esc(d)} ${esc(tm)}</td>
        <td>${esc(o.item || "")}</td>
        <td class="r">${money(o.amount || 0)}</td>
        <td>${esc(o.note || "")}</td>
        <td class="tc"><button class="btn xs" data-del-order="${esc(o.id)}">🗑</button></td>
      `;
      ordersT.appendChild(tr);
    }
    ordersT.addEventListener("change", e => {
      if (e.target && e.target.matches('[data-inc="order"]')) recomputeTotals();
    });
    ordersT.querySelectorAll("[data-del-order]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this order?")) return;
        save(prev => { const n = ensure(prev); n.orders = (n.orders||[]).filter(x => x.id !== btn.dataset.delOrder); return n; });
        loadGuest(currentId);
      });
    });
  }

  function paintCustom(D, g){
    const gid = g.id;
    const list = (D.customItems||[]).filter(c => c.guestId===gid)
      .sort((a,b)=> (a.date||"").localeCompare(b.date||""));
    if (!list.length){ customT.innerHTML = `<tr><td colspan="6" class="tc muted">No items</td></tr>`; return; }
    customT.innerHTML = "";
    for (const c of list){
      const d = (c.date||"").slice(0,10);
      const tm = (c.date||"").slice(11,16);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-inc="custom" data-id="${esc(c.id)}" checked></td>
        <td>${esc(d)} ${esc(tm)}</td>
        <td>${esc(c.desc || "")}</td>
        <td class="r">${money(c.amount || 0)}</td>
        <td>${esc(c.note || "")}</td>
        <td class="tc"><button class="btn xs" data-del-custom="${esc(c.id)}">🗑</button></td>
      `;
      customT.appendChild(tr);
    }
    customT.addEventListener("change", e => {
      if (e.target && e.target.matches('[data-inc="custom"]')) recomputeTotals();
    });
    customT.querySelectorAll("[data-del-custom]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this custom item?")) return;
        save(prev => { const n = ensure(prev); n.customItems = (n.customItems||[]).filter(x => x.id !== btn.dataset.delCustom); return n; });
        loadGuest(currentId);
      });
    });
  }

  function paintPayments(D, g){
    const gid = g.id;
    const list = (D.payments||[]).filter(p => p.guestId===gid)
      .sort((a,b)=> (a.date||"").localeCompare(b.date||""));
    if (!list.length){ paysT.innerHTML = `<tr><td colspan="6" class="tc muted">No payments</td></tr>`; return; }
    paysT.innerHTML = "";
    for (const p of list){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-inc="pay" data-id="${esc(p.id)}" checked></td>
        <td>${esc((p.date||"").slice(0,10))} ${esc(p.time||"")}</td>
        <td>${esc(p.method || "")}</td>
        <td class="r">${money(p.amount || 0)}</td>
        <td>${esc(p.ref || "")}</td>
        <td class="tc"><button class="btn xs" data-del-pay="${esc(p.id)}">🗑</button></td>
      `;
      paysT.appendChild(tr);
    }
    paysT.addEventListener("change", e => {
      if (e.target && e.target.matches('[data-inc="pay"]')) recomputeTotals();
    });
    paysT.querySelectorAll("[data-del-pay]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this payment?")) return;
        save(prev => { const n = ensure(prev); n.payments = (n.payments||[]).filter(x => x.id !== btn.dataset.delPay); return n; });
        loadGuest(currentId);
      });
    });
  }

  function includedOrderIds(){ return Array.from(ordersT.querySelectorAll('[data-inc="order"]:checked')).map(el=>el.dataset.id); }
  function includedPayIds(){ return Array.from(paysT.querySelectorAll('[data-inc="pay"]:checked')).map(el=>el.dataset.id); }
  function includedCustomIds(){ return Array.from(customT.querySelectorAll('[data-inc="custom"]:checked')).map(el=>el.dataset.id); }

  function recomputeTotals(){
    const D = ensure(getState());
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId));
    if (!g){ [tRoom,tOrd,tExtras,tSub,tDisc,tPaid,tGrand,tDue].forEach(n=>n.textContent = money(0)); return; }

    const tmp = {
      ...g,
      roomRent: Number(rateI.value || g.roomRent || 0),
      halfNight: Boolean(halfI.checked),
      checkInDate: inI.value || g.checkInDate || todayISO(),
      checkOutDate: outI.value || g.checkOutDate || todayISO(),
      discountP: Number(discPI.value || 0),
      discountR: Number(discRI.value || 0)
    };

    // room
    let nights = calcNights(tmp.checkInDate, tmp.checkOutDate, tmp.halfNight);
    const room = round2(nights * Number(tmp.roomRent || 0));

    // included sets
    const incOrders = new Set(includedOrderIds());
    const incPays   = new Set(includedPayIds());
    const incCustom = new Set(includedCustomIds());

    // orders (+)
    const ord = (D.orders||[]).reduce((s,o)=> s + (o.guestId===g.id && incOrders.has(o.id) ? Number(o.amount||0) : 0), 0);
    // custom (+/-)
    const extras = (D.customItems||[]).reduce((s,c)=> s + (c.guestId===g.id && incCustom.has(c.id) ? Number(c.amount||0) : 0), 0);
    // payments (paid)
    const paid = (D.payments||[]).reduce((s,p)=> s + (p.guestId===g.id && incPays.has(p.id) ? Number(p.amount||0) : 0), 0);

    const subtotal = round2(room + ord + extras);
    let discount = round2(Number(tmp.discountR||0) + (Number(tmp.discountP||0)/100)*subtotal);
    if (discount > subtotal) discount = subtotal;

    const taxRate = Number((ensure(getState()).settings||{}).taxRate || 0);
    const tax = round2((subtotal - discount) * (taxRate / 100));
    const grand = round2(subtotal - discount + tax);
    const due = round2(grand - paid);

    tRoom.textContent = money(room);
    tOrd.textContent = money(ord);
    tExtras.textContent = money(extras);
    tSub.textContent = money(subtotal);
    tDisc.textContent = `- ${money(discount)}`;
    tPaid.textContent = money(paid);
    tGrand.textContent = money(grand);
    tDue.textContent = money(due);
  }

  function onQuickPay(){
    const D = ensure(getState());
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId));
    if (!g){ alert("Select a guest first"); return; }
    const amt = Number(qpAmt.value || 0);
    if (!(amt > 0)){ alert("Amount must be > 0"); return; }
    const p = {
      id: uid(),
      guestId: g.id, guestName: g.name || "Guest", roomNo: g.roomNo || "",
      date: qpDate.value || todayISO(), time: qpTime.value || nowTime(),
      amount: round2(amt), method: qpMet.value || "Cash", ref: qpRef.value || "", notes: qpNote.value || ""
    };
    save(prev => { const n = ensure(prev); n.payments = [p, ...(n.payments||[])]; return n; });
    qpAmt.value = qpRef.value = qpNote.value = "";
    loadGuest(currentId);
  }

  function onAddCustom(){
    const D = ensure(getState());
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId));
    if (!g){ alert("Select a guest first"); return; }
    const desc = (ciDesc.value || "").trim();
    const amt = Number(ciAmt.value || 0);
    if (!desc){ alert("Description required"); return; }
    if (!amt && amt !== 0){ alert("Amount required"); return; }
    const it = {
      id: uid(),
      guestId: g.id,
      date: new Date().toISOString(),
      desc, amount: round2(amt),
      note: (ciNote.value || "")
    };
    save(prev => { const n = ensure(prev); n.customItems = [it, ...(n.customItems||[])]; return n; });
    ciDesc.value = ciAmt.value = ciNote.value = "";
    loadGuest(currentId);
  }

  // ------- Checkout actions -------
  function maybeBumpToTomorrow(){
    const now = new Date(); const hrs = now.getHours();
    const today = todayISO(); const outSel = outI.value || today;
    if (hrs >= 18 && outSel === today){
      const ans = confirm("It's after 6:00 PM. Do you want to set check-out to tomorrow and charge an extra night?");
      if (ans){ const t = new Date(); t.setDate(t.getDate()+1); outI.value = t.toISOString().slice(0,10); recomputeTotals(); updateSummary(); }
    }
  }

  function checkout({ allowDues }){
    maybeBumpToTomorrow();

    const D = ensure(getState());
    const gIdx = (D.guests||[]).findIndex(x => String(x.id)===String(currentId));
    if (gIdx < 0){ alert("Select a guest"); return; }
    const g = { ...D.guests[gIdx] };

    const dueText = host.querySelector("#t-due").textContent || "0";
    const dueVal = Number(dueText.replace(/[^\d.-]/g,"")) || 0;

    if (!allowDues && dueVal > 0){
      alert("Guest has dues. Use 'Checkout with Dues' or add payment.");
      return;
    }

    save(prev => {
      const n = ensure(prev);
      const guest = { ...n.guests[gIdx] };
      guest.checkedOut = true;
      guest.status = "checked-out";
      guest.checkOutDate = outI.value || todayISO();
      guest.checkOutTime = nowTime();
      guest.roomRent = Number(rateI.value || guest.roomRent || 0);
      guest.halfNight = Boolean(halfI.checked);
      guest.discountP = Number(discPI.value || 0);
      guest.discountR = Number(discRI.value || 0);

      n.guests = [...n.guests]; n.guests[gIdx] = guest;

      n.stays = [
        { id:`stay_${guest.id}_${Date.now()}`, guestId:guest.id, name:guest.name||"", roomNo:guest.roomNo||"", rate:guest.roomRent||0, checkIn:guest.checkInDate||todayISO(), checkOut:guest.checkOutDate },
        ...(n.stays||[])
      ];

      // free room
      if (guest.roomNo){
        const idx = (n.rooms||[]).findIndex(r => String(r.number ?? r.no ?? r.roomNo ?? "") === (guest.roomNo + ""));
        if (idx >= 0){ const r = { ...n.rooms[idx] }; delete r.guestId; r.occupied=false; r.status="vacant"; n.rooms=[...n.rooms]; n.rooms[idx]=r; }
      }
      return n;
    });

    alert(allowDues ? "Checked out with dues recorded." : "Checked out. No dues.");
    populateGuestSelect();
  }

  /* ------------------------ INVOICE (same template as payments.js) ------------------------ */

  function baseCSS() {
    return `
    <style>
      :root{--ink:#111;--muted:#6b7280;--border:#d1d5db;--accent:#374151;--pad:12mm;
            --band:#f3f4f6;--tableHead:#f8fafc;--balance:#4b5563;--balanceText:#fff;
            --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;}
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
      .doctitle{font-size:28px;margin:0}
      .docmeta{text-align:right;font-size:12px}
      .muted{color:var(--muted)}
      .invno{margin-top:6px;border-bottom:1px solid var(--border);padding-bottom:6px}
      .invno .value{font-weight:600;margin-left:8px;color:#1f2937}
      .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;margin-top:6px}
      .party-title{font-weight:700;color:#1f2937;margin-bottom:4px}
      .party-lines div{line-height:1.35}
      table.items{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
      .items th,.items td{border:1px solid var(--border);padding:8px 10px;vertical-align:top}
      .items thead th{background:#f8fafc;font-weight:700}
      .col-desc{width:60%}.col-qty{width:8%;text-align:center}.col-unit{width:16%;text-align:right}.col-total{width:16%;text-align:right}
      .below{display:grid;grid-template-columns:1fr 260px;gap:14px 24px;align-items:start;margin-top:8px}
      .remarks .remarks-box{min-height:32px;border:1px solid var(--border);border-radius:6px;padding:8px;white-space:pre-wrap}
      .totals{display:flex;flex-direction:column;gap:6px}
      .totals .trow{display:flex;justify-content:space-between;gap:10px}
      .balance{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:6px;background:#4b5563;color:#fff;border-radius:4px;padding:8px 10px;font-weight:700}
      .fine{margin-top:8px;font-size:11px;color:#6b7280}
    </style>`;
  }
  function renderTop(css, title, data) {
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

  function renderInvoiceHTML(data) {
    const css = baseCSS(); const top = renderTop(css, "Invoice", data);
    return `
${top}
  <div class="docrow">
    <h1 class="doctitle">INVOICE</h1>
    <div class="docmeta"><div><span class="muted">DATE:</span> ${esc(data.date || "")}</div></div>
  </div>

  <div class="invno muted"><span class="value">${esc(data.roomLabel || "")}</span></div>

  <div class="parties">
    <div class="party">
      <div class="party-title">BILL TO</div>
      <div class="party-lines">
        <div>${esc(data.bill?.contactName || "")}</div>
        <div>${esc(data.bill?.address || "")}</div>
        <div>${esc(data.bill?.phone || "")}</div>
      </div>
    </div>
    <div class="party">
      <div class="party-title">STAY DETAILS</div>
      <div class="party-lines">
        <div>Check-In: (${esc(data.stay?.inDateDMY || "")}) ${esc(data.stay?.inTime || "")}</div>
        <div>Check-Out: (${esc(data.stay?.outDateDMY || "")}) ${esc(data.stay?.outTime || "")}</div>
        <div>Nights: ${esc(data.stay?.nights || "0")}</div>
        <div>Persons: ${esc(data.stay?.persons || "1")}</div>
      </div>
    </div>
  </div>

  <table class="items">
    <thead><tr><th class="col-desc">DESCRIPTION</th><th class="col-qty">QTY</th><th class="col-unit">UNIT PRICE</th><th class="col-total">TOTAL</th></tr></thead>
    <tbody>
      ${(data.items || []).map(it => `
        <tr><td class="col-desc">${esc(it.description || "")}</td>
            <td class="col-qty">${esc(it.qty ?? "")}</td>
            <td class="col-unit">${esc(it.unitPrice || "")}</td>
            <td class="col-total">${esc(it.lineTotal || "")}</td></tr>`).join("")
            || `<tr><td></td><td></td><td></td><td></td></tr>`}
    </tbody>
  </table>

  <div class="below">
    <div class="remarks">
      <div class="muted">Remarks:</div>
      <div class="remarks-box">${esc(data.remarks || "")}</div>
    </div>
    <div class="totals">
      <div class="trow"><span>SUBTOTAL</span><span>${esc(data.subtotal)}</span></div>
      <div class="trow"><span>DISCOUNT</span><span>${esc(data.discount)}</span></div>
      <div class="trow"><span>TAX</span><span>${esc(data.totalTax)}</span></div>
      <div class="trow"><span>GRAND TOTAL</span><span>${esc(data.grandTotal)}</span></div>
      <div class="trow"><span>AMOUNT PAID</span><span>${esc(data.amountPaid)}</span></div>
      <div class="balance"><span>Balance</span><span>${esc(data.balanceDue)}</span></div>
    </div>
  </div>
  <div class="fine">This invoice was generated by the system.</div>
</section>
</body></html>`;
  }

  function buildCommon(S, g, fin, roomLabel) {
    return {
      hotelName: S.hotelName || "Hotel",
      hotelAddress: S.address || "",
      hotelContact: S.phone || "",
      logo: S.logo || "",
      roomLabel,
      bill: {
        contactName: g.name || "Guest",
        address: g.address || "",
        phone: g.mobile || ""
      },
      subtotal: invMoney(fin.subtotal),
      discount: invMoney(fin.discount),
      subtotalLessDiscount: invMoney(fin.subtotal - fin.discount),
      totalTax: invMoney(fin.tax),
      grandTotal: invMoney(fin.grand),
      amountPaid: invMoney(fin.paid),
      balance: invMoney(fin.balance),
      balanceDue: invMoney(fin.balance),
      remarks: (S.invoiceFooter || "")
    };
  }

  /* Build invoice numbers from CURRENT editor selections (orders/custom selected, discounts, tax) */
  function computeFromEditor() {
    const D = ensure(getState());
    const S = D.settings || {};
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId)) || {};

    const nights = calcNights(inI.value || g.checkInDate || todayISO(), outI.value || g.checkOutDate || todayISO(), halfI.checked);
    const room = round2(nights * Number(rateI.value || g.roomRent || 0));

    const incOrders = new Set(includedOrderIds());
    const incPays   = new Set(includedPayIds());
    const incCustom = new Set(includedCustomIds());

    const ordersAmt = (D.orders||[]).reduce((s,o)=> s + (o.guestId===g.id && incOrders.has(o.id) ? Number(o.amount||0) : 0), 0);
    const extrasAmt = (D.customItems||[]).reduce((s,c)=> s + (c.guestId===g.id && incCustom.has(c.id) ? Number(c.amount||0) : 0), 0);
    const paidAmt   = (D.payments||[]).reduce((s,p)=> s + (p.guestId===g.id && incPays.has(p.id) ? Number(p.amount||0) : 0), 0);

    const subtotal = round2(room + ordersAmt + extrasAmt);
    let discount = round2(Number(discRI.value || 0) + (Number(discPI.value || 0)/100)*subtotal);
    if (discount > subtotal) discount = subtotal;

    const taxRate = Number(S.taxRate || 0);
    const tax = round2((subtotal - discount) * (taxRate / 100));
    const grand = round2(subtotal - discount + tax);
    const balance = round2(grand - paidAmt);

    return { nights, room, orders: ordersAmt, extras: extrasAmt, subtotal, discount, tax, grand, paid: paidAmt, balance };
  }

  function printInvoice(){
    const D = ensure(getState());
    const S = D.settings || {};
    const g = (D.guests||[]).find(x => String(x.id)===String(currentId));
    if (!g){ alert("Select a guest"); return; }

    const fin = computeFromEditor();

    const items = [];
    if (fin.room > 0) items.push({
      description: `Room Rent (${fin.nights} night${fin.nights > 1 ? "s" : ""} @ ${invMoney(rateI.value || g.roomRent || 0)})`,
      qty: fin.nights, unitPrice: invMoney(rateI.value || g.roomRent || 0), lineTotal: invMoney(fin.room)
    });
    if (fin.orders > 0) items.push({ description: `Orders / Services`, qty: 1, unitPrice: invMoney(fin.orders), lineTotal: invMoney(fin.orders) });
    if (fin.extras !== 0) items.push({ description: `Extras / Adjustments`, qty: 1, unitPrice: invMoney(fin.extras), lineTotal: invMoney(fin.extras) });
    if (fin.discount > 0) items.push({ description: `Discount`, qty: 1, unitPrice: invMoney(-fin.discount), lineTotal: invMoney(-fin.discount) });

    // Format dates once for invoice
    const inISO  = (inI.value || g.checkInDate || "");
    const outISO = (outI.value || g.checkOutDate || "");
    const inDMY  = fmtDateDDMY(inISO);
    const outDMY = fmtDateDDMY(outISO);

    const data = {
      ...buildCommon(S, g, fin, `ROOM ${g.roomNo || "-"}`),
      date: fmtDateDDMY(outISO || todayISO()),   // top-right invoice date
      items,
      stay: {
        inDateDMY: inDMY, inTime: g.checkInTime || "",
        outDateDMY: outDMY, outTime: g.checkOutTime || "",
        nights: fin.nights, persons: g.persons || 1
      }
    };

    const html = renderInvoiceHTML(data);
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(html); w.document.close();
  }
}
