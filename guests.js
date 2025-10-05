// tabs/guests.js — Identity Ledger (CNIC/Phone) with full history, attachments, per-guest preferred rate, stay deletion, and COMPLETE print
// Select a guest → we match all guest records with the same CNIC or Phone (normalized) and show ONE combined ledger.
// Print includes EVERY stay for that person in one table.

import { store } from "../state.js";
import { money } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => (
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]
));
const todayISO = () => new Date().toISOString().slice(0,10);
const nowTime  = () => new Date().toTimeString().slice(0,5);
const round0   = n => Math.round(Number(n||0));

function ensure(d){
  const n = d ? { ...d } : {};
  for (const k of ["guests","orders","payments","expenses","stays","rooms"]) if (!Array.isArray(n[k])) n[k] = [];
  n.settings ||= {};
  return n;
}
function getS(){ try{ if (typeof store?.get === "function") return store.get(); }catch{} return (window.__APP_STATE__ || {}); }
function save(updater){
  if (typeof store?.update === "function") { store.update(prev => updater(ensure(prev))); return; }
  const next = updater(ensure(getS()));
  if (typeof store?.set === "function") store.set(next);
  else if (typeof store?.setState === "function") store.setState(next);
  else window.__APP_STATE__ = next;
}

/* ---------- identity: normalize CNIC & Phone and build matching cluster ---------- */
const digits = s => String(s||"").replace(/\D+/g,"");
function normCNIC(v){
  const d = digits(v);
  return d || "";
}
function normPhone(v){
  let d = digits(v);
  if (d.startsWith("0092")) d = d.slice(4);
  if (d.startsWith("92")) d = d.slice(2);
  if (d.length === 10) d = "0" + d;
  return d || "";
}

// Build the identity cluster for a seed guest: every guest sharing the same CNIC OR Phone.
// Fallback: if neither exists on seed, we keep just that seed id (so the screen still works).
function identityCluster(D, seedGuest){
  const seedCNIC = normCNIC(seedGuest?.cnic);
  const seedPhone = normPhone(seedGuest?.mobile);
  const ids = new Set();
  const phones = new Set();
  const cnics = new Set();
  if (seedCNIC) cnics.add(seedCNIC);
  if (seedPhone) phones.add(seedPhone);

  const allGuests = (D.guests||[]);
  for (const g of allGuests){
    const c = normCNIC(g.cnic), p = normPhone(g.mobile);
    if ((seedCNIC && c && c===seedCNIC) || (seedPhone && p && p===seedPhone)){
      ids.add(g.id);
      if (c) cnics.add(c);
      if (p) phones.add(p);
    }
  }
  if (!ids.size && seedGuest?.id) ids.add(seedGuest.id);

  // Prefer CNIC as stable key, otherwise use phone (first in the set)
  const preferredKey = (cnics.size ? `cnic:${Array.from(cnics)[0]}` :
                        phones.size ? `phone:${Array.from(phones)[0]}` : "");

  return { ids, cnics, phones, preferredKey };
}

/* ---------- finance helpers ---------- */
function diffNights(aISO, bISO){
  if(!aISO||!bISO) return 0;
  const a=new Date(aISO+"T00:00:00"), b=new Date(bISO+"T00:00:00");
  return Math.max(0, Math.floor((b-a)/86400000));
}
function nightsForStay(st){ return diffNights((st.checkIn||"").slice(0,10), (st.checkOut||"").slice(0,10)); }

// Compute identity-level ledger across the cluster ids
function computeIdentityLedger(D, idSet){
  const ids = new Set(idSet);
  if (!ids.size) return { stays:[], orders:[], pays:[], attachments:[], roomAmt:0, ordersAmt:0, paidAmt:0, total:0, due:0 };

  const guestsMap = new Map((D.guests||[]).map(g => [String(g.id), g]));

  // If any guest is currently checked-in, add a *preview* stay up to today
  const previewStays = [];
  for (const gid of ids){
    const g = guestsMap.get(String(gid));
    if (g && String(g.status||"").toLowerCase()==="checked-in" && !g.checkedOut){
      previewStays.push({
        id: "current_"+gid,
        guestId: gid,
        name: g.name || "",
        roomNo: g.roomNo || "",
        rate: Number(g.roomRent||0),
        checkIn: (g.checkInDate||todayISO()),
        checkOut: todayISO(),
        _preview: true
      });
    }
  }

  const stays = [
    ...previewStays,
    ...(D.stays||[]).filter(s => ids.has(String(s.guestId)))
  ];

  const orders = (D.orders||[]).filter(o => ids.has(String(o.guestId)));
  const pays   = (D.payments||[]).filter(p => ids.has(String(p.guestId)));

  const roomAmt = stays.reduce((sum, st)=> sum + (nightsForStay(st) * Number(st.rate||0)), 0);
  const ordersAmt = orders.reduce((s,o)=> s + Number(o.amount||0), 0);
  const paidAmt = pays.reduce((s,p)=> s + Number(p.amount||0), 0);

  const total = round0(roomAmt + ordersAmt);
  const due   = round0(total - paidAmt);

  // Collect attachments from *all* guest records in the cluster
  const attachments = [];
  for (const gid of ids){
    const g = guestsMap.get(String(gid));
    if (g?.attachment?.dataURL){
      attachments.push({ guestId: gid, name: g.attachment.name || "Attachment", dataURL: g.attachment.dataURL, type: g.attachment.type || "" });
    }
  }

  return { stays, orders, pays, attachments, roomAmt: round0(roomAmt), ordersAmt: round0(ordersAmt), paidAmt: round0(paidAmt), total, due };
}

/* ---------- preferred rate (stored in settings.ratebook) ---------- */
function getRatebook(D){
  const rb = (D.settings && D.settings.ratebook) || {};
  return (rb && typeof rb === "object") ? rb : {};
}
function getPreferredRate(D, preferredKey){
  const rb = getRatebook(D);
  return Number(rb[preferredKey] || 0) || 0;
}
function setPreferredRate(preferredKey, value){
  const rate = Math.max(0, Math.round(Number(value||0)));
  const D = getS();
  const rb = getRatebook(D);
  const nextRB = { ...rb };
  if (rate > 0) nextRB[preferredKey] = rate; else delete nextRB[preferredKey];
  if (typeof store?.patch === "function"){
    store.patch({ settings: { ...(D.settings||{}), ratebook: nextRB } });
  } else {
    save(prev => { const n = ensure(prev); n.settings = { ...(n.settings||{}), ratebook: nextRB }; return n; });
  }
}

/* small style helpers */
const MMM = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtD = iso => { if(!iso) return ""; const d=new Date(iso.slice(0,10)+"T00:00:00"); if(isNaN(d)) return ""; const dd=String(d.getDate()).padStart(2,"0"); return `${dd}-${MMM[d.getMonth()]}-${d.getFullYear()}`; };

/* ===================== VIEW ===================== */
export default async function view(){
  const host = document.createElement("section");
  host.className = "card";
  host.setAttribute("data-view", "guests");

  host.innerHTML = `
    <header class="view-header">
      <h2>Guests</h2>
      <div class="filters">
        <input id="q" class="input sm" placeholder="Search by name / mobile / CNIC / room…">
      </div>
    </header>

    <section class="panel">
      <div class="table-wrap">
        <table class="table mini">
          <thead>
            <tr>
              <th>Guest</th>
              <th>Mobile</th>
              <th>CNIC</th>
              <th>Current Status</th>
              <th>Room</th>
              <th class="r">Lifetime Bill</th>
              <th class="r">Paid</th>
              <th class="r red">Due</th>
              <th class="col-actions">Action</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="9" class="tc muted">No guests</td></tr></tbody>
        </table>
      </div>
    </section>

    <!-- Detail Modal (IDENTITY view) -->
    <div class="modal" id="g-modal" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="modal-card" role="document">
        <div class="modal-head">
          <h3 id="m-title">Guest Details</h3>
          <button class="btn xs ghost" id="m-close" title="Close">✕</button>
        </div>
        <div class="modal-body">
          <div id="m-summary" class="summary-cards"></div>

          <div class="cardx">
            <div class="pref-rate">
              <label for="rateI"><strong>Preferred Room Rent</strong> (applies to this person’s future stays)</label>
              <div class="pref-row">
                <input id="rateI" class="input sm" type="number" min="0" step="1" placeholder="0">
                <button class="btn xs" id="rate-save">Save Rate</button>
                <button class="btn xs ghost" id="rate-clear">Clear</button>
                <span class="muted" id="rate-key"></span>
              </div>
            </div>
          </div>

          <div class="cardx">
            <h4>Stays (All Time for this Person)</h4>
            <div class="table-wrap">
              <table class="table mini">
                <thead><tr>
                  <th>#</th>
                  <th>Check-In</th><th>Check-Out</th><th>Room</th>
                  <th class="r">Rate</th><th class="r">Nights</th><th class="r">Room Amt</th><th class="col-actions">Action</th>
                </tr></thead>
                <tbody id="m-stays"><tr><td colspan="8" class="tc muted">—</td></tr></tbody>
              </table>
            </div>
          </div>

          <div class="grid-2">
            <div class="cardx">
              <h4>Orders / Invoices</h4>
              <div class="table-wrap">
                <table class="table mini">
                  <thead><tr><th>Date</th><th>Item</th><th>Note</th><th class="r">Amount</th></tr></thead>
                  <tbody id="m-orders"><tr><td colspan="4" class="tc muted">—</td></tr></tbody>
                </table>
              </div>
            </div>
            <div class="cardx">
              <h4>Payments</h4>
              <div class="table-wrap">
                <table class="table mini">
                  <thead><tr><th>Date</th><th>Mode</th><th>Note</th><th class="r">Amount</th></tr></thead>
                  <tbody id="m-pays"><tr><td colspan="4" class="tc muted">—</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="cardx">
            <h4>Attachments</h4>
            <div id="m-attach-list" class="attach-list muted">—</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="m-print">Print Guest Ledger</button>
          <button class="btn warn" id="m-delete">Delete This Guest Record</button>
        </div>
      </div>
      <div class="modal-backdrop" id="m-backdrop"></div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
  [data-view="guests"]{
    --border:#e6e9ef; --muted:#717a8a; --ink:#0f172a;
    --surface:#ffffff; --soft:#f6f8fb; --shadow:0 6px 24px rgba(15,23,42,.06), 0 1px 4px rgba(15,23,42,.06);
    --green:#16a34a; --amber:#d97706; --red:#dc2626;
  }
  .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .input{height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f8fafc}
  .input.sm{height:34px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
  .table.mini{width:100%;border-collapse:separate;border-spacing:0}
  .table.mini thead th{position:sticky;top:0;background:#f4f6fa;border-bottom:1px solid var(--border);padding:10px;text-align:left;font-weight:700}
  .table.mini td{padding:10px;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:middle}
  .table .col-actions{width:160px}
  .r{text-align:right}.tc{text-align:center}.muted{color:var(--muted)} .red{color:var(--red)}
  .btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
  .btn.xs{height:30px;padding:0 10px;border-radius:8px}
  .btn.warn{background:#f59e0b;border-color:#d97706;color:#111827;font-weight:800}
  .btn.warn:hover{background:#fbbf24}
  .summary-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}
  .summary-cards .cardy{display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid var(--border);border-radius:12px;background:#f9fafb;box-shadow:var(--shadow)}
  .summary-cards .t{font-size:12px;color:var(--muted)} .summary-cards .v{font-weight:800;color:#111}
  .modal{position:fixed;inset:0;display:none;z-index:9999}
  .modal[open]{display:block}
  .modal-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.45)}
  .modal-card{position:relative;margin:5vh auto 0;max-width:1000px;width:96vw;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;max-height:92vh;box-shadow:0 20px 60px rgba(2,8,23,.25);z-index:1}
  .modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid var(--border)}
  .modal-body{padding:12px;overflow:auto;flex:1 1 auto}
  .modal-actions{position:sticky;bottom:0;padding:12px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:#fff;z-index:2}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .cardx{border:1px solid var(--border);border-radius:12px;padding:10px;background:#f7f9fc;margin-top:10px}
  .pref-rate .pref-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
  .attach-list{display:flex;flex-direction:column;gap:6px}
  @media (max-width:900px){ .summary-cards{grid-template-columns:1fr 1fr} .grid-2{grid-template-columns:1fr} }
  `;
  host.appendChild(style);

  /* refs */
  const qs = s => host.querySelector(s);
  const q = qs("#q"), rows = qs("#rows");
  const modal = qs("#g-modal"), mTitle = qs("#m-title"), mClose = qs("#m-close"), mBackdrop = qs("#m-backdrop");
  const mSummary = qs("#m-summary"), mStays = qs("#m-stays"), mOrders = qs("#m-orders"), mPays = qs("#m-pays");
  const mAttachList = qs("#m-attach-list");
  const mPrint = qs("#m-print"), mDelete = qs("#m-delete");
  const rateI = qs("#rateI"), rateSave = qs("#rate-save"), rateClear = qs("#rate-clear"), rateKeyEl = qs("#rate-key");

  let currentGuestId = null;
  let currentIdentity = null; // {ids, cnics, phones, preferredKey}

  q.addEventListener("input", renderTable);
  mClose.addEventListener("click", closeModal);
  mBackdrop.addEventListener("click", closeModal);

  const unsub = store.subscribe?.(renderTable);
  host.addEventListener("DOMNodeRemoved", () => unsub?.());

  renderTable();
  return host;

  /* -------- list render -------- */
  function renderTable(){
    const D = ensure(getS());
    const qv = (q.value || "").toLowerCase().trim();
    const list = (D.guests||[])
      .slice()
      .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

    rows.innerHTML = "";
    if (!list.length) { rows.innerHTML = `<tr><td colspan="9" class="tc muted">No guests</td></tr>`; return; }

    const frag = document.createDocumentFragment();
    for (const g of list){
      if (qv){
        const blob = `${g.name||""} ${g.mobile||""} ${g.cnic||""} ${g.roomNo||""}`.toLowerCase();
        if (!blob.includes(qv)) continue;
      }
      // Identity totals for quick glance
      const cluster = identityCluster(D, g);
      const L = computeIdentityLedger(D, cluster.ids);
      const st = String(g.checkedOut ? "checked-out" : (g.status||"checked-in")).toLowerCase();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${esc(g.name||"Guest")}</strong></td>
        <td>${esc(g.mobile||"")}</td>
        <td>${esc(g.cnic||"")}</td>
        <td>${badge(st)}</td>
        <td>${esc(g.roomNo||"")}</td>
        <td class="r">${money(L.total)}</td>
        <td class="r">${money(L.paidAmt)}</td>
        <td class="r"><span class="red">${money(L.due)}</span></td>
        <td class="col-actions">
          <button class="btn xs" data-view="${esc(g.id)}">View</button>
          <button class="btn xs warn" data-del="${esc(g.id)}">Delete</button>
        </td>
      `;
      frag.appendChild(tr);
    }
    rows.appendChild(frag);

    rows.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => openModal(b.dataset.view)));
    rows.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteGuest(b.dataset.del)));
  }

  function badge(st){
    const s = String(st||"checked-in").toLowerCase();
    const tone = s==="arrival" ? "#fff7ed" : (s==="checked-out" ? "#fef2f2" : "#ecfdf5");
    const col  = s==="arrival" ? "#d97706" : (s==="checked-out" ? "#dc2626" : "#16a34a");
    const text = s==="arrival" ? "Arrival" : (s==="checked-out" ? "Checked-Out" : "Checked-In");
    return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${tone};border:1px solid #e6e9ef;color:${col};font-weight:700;min-width:88px;text-align:center">${esc(text)}</span>`;
  }

  /* -------- modal (identity view) -------- */
  function openModal(guestId){
    const D = ensure(getS());
    const g = (D.guests||[]).find(x => String(x.id)===String(guestId));
    if (!g) return;

    currentGuestId = g.id;
    currentIdentity = identityCluster(D, g);
    const L = computeIdentityLedger(D, currentIdentity.ids);

    mTitle.textContent = `${g.name || "Guest"} — Identity Ledger`;
    mSummary.innerHTML = `
      <div class="cardy"><div class="t">Total Bill</div><div class="v">${money(L.total)}</div></div>
      <div class="cardy"><div class="t">Total Received</div><div class="v">${money(L.paidAmt)}</div></div>
      <div class="cardy"><div class="t">Total Orders</div><div class="v">${money(L.ordersAmt)}</div></div>
      <div class="cardy"><div class="t">Due</div><div class="v" style="color:#dc2626">${money(L.due)}</div></div>
    `;

    // Preferred rate UI
    const prKey = currentIdentity.preferredKey || "";
    rateKeyEl.textContent = prKey ? `key: ${esc(prKey)}` : "";
    rateI.value = prKey ? String(getPreferredRate(D, prKey) || "") : "";
    rateI.disabled = !prKey;
    rateSave.disabled = !prKey;
    rateClear.disabled = !prKey;

    rateSave.onclick = () => {
      if (!prKey) return;
      setPreferredRate(prKey, Number(rateI.value||0));
      alert("Preferred rate saved.");
    };
    rateClear.onclick = () => {
      if (!prKey) return;
      setPreferredRate(prKey, 0);
      rateI.value = "";
      alert("Preferred rate cleared.");
    };

    // stays (identity) — sorted oldest→newest, with serial #
    if (!L.stays.length) {
      mStays.innerHTML = `<tr><td colspan="8" class="tc muted">—</td></tr>`;
    } else {
      const frag = document.createDocumentFragment();
      const sorted = L.stays.slice().sort((a,b)=> (a.checkIn||"").localeCompare(b.checkIn||""));
      let i = 1;
      for (const st of sorted){
        const n = nightsForStay(st);
        const amt = n * Number(st.rate||0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="r">${i++}</td>
          <td>${esc(fmtD(st.checkIn||""))}</td>
          <td>${esc(fmtD(st.checkOut||""))}</td>
          <td>${esc(st.roomNo||"")}</td>
          <td class="r">${money(st.rate||0)}</td>
          <td class="r">${n}</td>
          <td class="r">${money(amt)}</td>
          <td class="col-actions">
            ${st._preview ? `<span class="muted">current</span>` :
              `<button class="btn xs warn" data-del-stay="${esc(st.id)}">Delete</button>`}
          </td>
        `;
        frag.appendChild(tr);
      }
      mStays.innerHTML = ""; mStays.appendChild(frag);
      mStays.querySelectorAll("[data-del-stay]").forEach(btn => {
        btn.addEventListener("click", () => onDeleteStay(btn.dataset.delStay));
      });
    }

    // orders
    if (!L.orders.length){
      mOrders.innerHTML = `<tr><td colspan="4" class="tc muted">—</td></tr>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const o of L.orders.sort((a,b)=>(`${a.date||""} ${a.time||""}`).localeCompare(`${b.date||""} ${b.time||""}`))){
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc((o.date||"").slice(0,10))} ${esc(o.time||"")}</td>
          <td>${esc(o.item||"")}</td>
          <td>${esc(o.note||"")}</td>
          <td class="r">${money(o.amount||0)}</td>
        `;
        frag.appendChild(tr);
      }
      mOrders.innerHTML = ""; mOrders.appendChild(frag);
    }

    // payments
    if (!L.pays.length){
      mPays.innerHTML = `<tr><td colspan="4" class="tc muted">—</td></tr>`;
    } else {
      const frag = document.createDocumentFragment();
      for (const p of L.pays.sort((a,b)=>(`${a.date||""} ${a.time||""}`).localeCompare(`${b.date||""} ${b.time||""}`))){
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc((p.date||"").slice(0,10))} ${esc(p.time||"")}</td>
          <td>${esc(p.mode || p.method || "")}</td>
          <td>${esc(p.note||"")}</td>
          <td class="r">${money(p.amount||0)}</td>
        `;
        frag.appendChild(tr);
      }
      mPays.innerHTML = ""; mPays.appendChild(frag);
    }

    // attachments list (identity)
    if (!L.attachments?.length){
      mAttachList.textContent = "—";
    } else {
      mAttachList.innerHTML = "";
      for (const a of L.attachments){
        const row = document.createElement("div");
        row.innerHTML = `
          <button class="btn xs" data-open-att="${esc(a.guestId)}">Open</button>
          <span class="muted">${esc(a.name)} (${esc(a.type||"file")})</span>
        `;
        mAttachList.appendChild(row);
      }
      mAttachList.querySelectorAll("[data-open-att]").forEach(btn => {
        btn.addEventListener("click", () => {
          const gid = btn.dataset.openAtt;
          const g = (getS().guests||[]).find(gg => String(gg.id)===String(gid));
          if (!g?.attachment?.dataURL){ alert("No attachment found."); return; }
          const w = window.open("", "_blank");
          w.document.write(`<html><body style="margin:0"><embed src="${g.attachment.dataURL}" style="width:100%;height:100vh"/></body></html>`);
          w.document.close();
        });
      });
    }

    mPrint.onclick = () => printLedgerIdentity(g, currentIdentity, L);
    mDelete.onclick = () => onDeleteGuest(g.id);

    openModalShow();
  }
  function openModalShow(){ modal.setAttribute("open",""); modal.setAttribute("aria-hidden","false"); }
  function closeModal(){ currentGuestId=null; currentIdentity=null; modal.removeAttribute("open"); modal.setAttribute("aria-hidden","true"); }

  /* -------- delete single stay -------- */
  function onDeleteStay(stayId){
    if (!stayId) return;
    const D = ensure(getS());
    const st = (D.stays||[]).find(s => String(s.id)===String(stayId));
    if (!st){ alert("Stay not found."); return; }
    if (!confirm("Delete this stay record? This cannot be undone.")) return;

    save(prev => {
      const n = ensure(prev);
      n.stays = (n.stays||[]).filter(s => String(s.id)!==String(stayId));
      return n;
    });

    // refresh current modal view
    if (currentGuestId) openModal(currentGuestId);
  }

  /* -------- delete full guest record (only the selected guest id) -------- */
  function onDeleteGuest(id){
    const D = ensure(getS());
    const g = (D.guests||[]).find(x => String(x.id)===String(id));
    if (!g){ alert("Guest not found."); return; }

    const msg = `Delete this GUEST RECORD for "${g.name || "Guest"}"?\n\nThis removes this single guest profile and any orders/payments tied to this profile.\n\nNote: Other profiles with the same CNIC/Phone will remain.\n\nThis cannot be undone.`;
    if (!confirm(msg)) return;

    save(prev => {
      const n = ensure(prev);
      n.guests   = (n.guests||[]).filter(x => String(x.id)!==String(id));
      n.orders   = (n.orders||[]).filter(x => String(x.guestId)!==String(id));
      n.payments = (n.payments||[]).filter(x => String(x.guestId)!==String(id));
      n.stays    = (n.stays||[]).filter(x => String(x.guestId)!==String(id));
      // Free room if needed
      if (g.roomNo && String(g.status||"").toLowerCase()==="checked-in" && !g.checkedOut){
        const idx = (n.rooms||[]).findIndex(r => String(r.guestId||"")===String(g.id));
        if (idx>=0){
          const r = { ...n.rooms[idx] }; delete r.guestId; r.occupied=false; r.status="vacant";
          const next=[...n.rooms]; next[idx]=r; n.rooms=next;
        }
      }
      return n;
    });

    closeModal();
    renderTable();
  }

  /* -------- printing (IDENTITY) — includes ALL stays in one table -------- */
  function printLedgerIdentity(seedGuest, identity, L){
    const S = (getS().settings || {});
    const title = `Ledger - ${seedGuest.name||"Guest"}`;
    const css = `
      <style>
        :root{--ink:#111;--muted:#6b7280;--border:#d1d5db;--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial}
        @page{size:A4;margin:12mm}
        body{margin:0;background:#fff;color:var(--ink);font-family:var(--font);-webkit-print-color-adjust:exact;print-color-adjust:exact}
        h1{margin:0 0 4mm 0;font-size:18px}
        .muted{color:var(--muted);font-size:12px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}
        th,td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
        thead th{background:#f8fafc}
        .r{text-align:right}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .box{border:1px solid var(--border);padding:8px;border-radius:6px}
      </style>
    `;

    // sort stays oldest→newest and add serial numbers in print
    const sortedStays = L.stays.slice().sort((a,b)=> (a.checkIn||"").localeCompare(b.checkIn||""));
    const staysRows = sortedStays.map((st, idx)=>{
      const n = nightsForStay(st);
      const amt = n * Number(st.rate||0);
      return `<tr>
        <td class="r">${idx+1}</td>
        <td>${esc((st.checkIn||"").slice(0,10))}</td>
        <td>${esc((st.checkOut||"").slice(0,10))}</td>
        <td>${esc(st.roomNo||"")}</td>
        <td class="r">${money(st.rate||0)}</td>
        <td class="r">${n}</td>
        <td class="r">${money(amt)}</td>
      </tr>`;
    }).join("");

    const ordersRows = L.orders
      .slice()
      .sort((a,b)=>(`${a.date||""} ${a.time||""}`).localeCompare(`${b.date||""} ${b.time||""}`))
      .map(o=>`
        <tr><td>${esc((o.date||"").slice(0,10))}</td><td>${esc(o.time||"")}</td><td>${esc(o.item||"")}</td><td>${esc(o.note||"")}</td><td class="r">${money(o.amount||0)}</td></tr>
      `).join("");

    const paysRows = L.pays
      .slice()
      .sort((a,b)=>(`${a.date||""} ${a.time||""}`).localeCompare(`${b.date||""} ${b.time||""}`))
      .map(p=>`
        <tr><td>${esc((p.date||"").slice(0,10))}</td><td>${esc(p.time||"")}</td><td>${esc(p.mode||p.method||"")}</td><td>${esc(p.note||"")}</td><td class="r">${money(p.amount||0)}</td></tr>
      `).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>${css}</head><body>
      <h1>${esc(S.hotelName || "Hotel")} — Guest Identity Ledger</h1>
      <div class="muted">${esc(S.address || "")} ${S.phone ? "• "+esc(S.phone) : ""}</div>

      <div class="box" style="margin-top:8px">
        <strong>${esc(seedGuest.name||"Guest")}</strong><br/>
        CNIC(s): ${Array.from(identity.cnics).map(esc).join(", ") || "—"}<br/>
        Phone(s): ${Array.from(identity.phones).map(esc).join(", ") || "—"}<br/>
      </div>

      <div class="grid" style="margin-top:8px">
        <div class="box"><div>Total Bill</div><div class="r"><strong>${money(L.total)}</strong></div></div>
        <div class="box"><div>Total Received</div><div class="r"><strong>${money(L.paidAmt)}</strong></div></div>
        <div class="box"><div>Total Orders</div><div class="r"><strong>${money(L.ordersAmt)}</strong></div></div>
        <div class="box"><div>Due</div><div class="r"><strong>${money(L.due)}</strong></div></div>
      </div>

      <h2 style="font-size:14px;margin-top:10px">Stays (All Time)</h2>
      <table>
        <thead><tr><th>#</th><th>Check-In</th><th>Check-Out</th><th>Room</th><th class="r">Rate</th><th class="r">Nights</th><th class="r">Room Amt</th></tr></thead>
        <tbody>${staysRows || `<tr><td colspan="7" class="muted">—</td></tr>`}</tbody>
      </table>

      <h2 style="font-size:14px;margin-top:10px">Orders</h2>
      <table><thead><tr><th>Date</th><th>Time</th><th>Item</th><th>Note</th><th class="r">Amount</th></tr></thead>
      <tbody>${ordersRows || `<tr><td colspan="5" class="muted">—</td></tr>`}</tbody></table>

      <h2 style="font-size:14px;margin-top:10px">Payments</h2>
      <table><thead><tr><th>Date</th><th>Time</th><th>Mode</th><th>Note</th><th class="r">Amount</th></tr></thead>
      <tbody>${paysRows || `<tr><td colspan="5" class="muted">—</td></tr>`}</tbody></table>

      <div class="muted" style="margin-top:12px">Printed: ${todayISO()} ${nowTime()}</div>
    </body></html>`;

    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(html); w.document.close();
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch{} }, 80);
  }
}
