// tabs/inhouse.js — In-House with softer UI, emoji KPIs, bold guest names, aligned table, and formatted dates
// Faster + snappy: optimistic updates, double-click guards, and requestAnimationFrame render scheduling.

import { store } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const round2 = n => Math.round(Number(n || 0) * 100) / 100;

/* ---- display formatters ---- */
const MMM = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date((String(iso).slice(0,10)) + "T00:00:00");
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MMM[d.getMonth()]}-${d.getFullYear()}`;
}

function getState() { try { if (typeof store?.get === "function") return store.get(); } catch { } return (window.__APP_STATE__ || {}); }
function ensure(d) {
    const n = d ? { ...d } : {};
    for (const k of ["guests", "orders", "payments", "expenses", "stays", "rooms"]) if (!Array.isArray(n[k])) n[k] = [];
    n.settings ||= {};
    return n;
}
function save(updater) {
    if (typeof store?.update === "function") { store.update(prev => updater(ensure(prev))); return; }
    const curr = ensure(getState()); const next = updater(curr);
    if (typeof store?.set === "function") store.set(next);
    else if (typeof store?.setState === "function") store.setState(next);
    else window.__APP_STATE__ = next;
}

import { money } from "../state.js";

function diffNights(aISO, bISO) {
    if (!aISO || !bISO) return 0;
    const a = new Date(aISO + "T00:00:00"), b = new Date(bISO + "T00:00:00");
    return Math.max(0, Math.floor((b - a) / 86400000)); // end-exclusive
}

/* Rooms helpers (tolerant) */
const roomNoOf = r => String(r.number ?? r.no ?? r.roomNo ?? r.name ?? r.id ?? "").trim();
const roomRateOf = r => Number(r.rate ?? r.rent ?? r.price ?? r.tariff ?? r.amount ?? 0);
const roomOcc = r => Boolean(r.occupied ?? r.isOccupied ?? r.busy ?? (r.status && String(r.status).toLowerCase() !== "vacant") ?? false);
function occupyRoom(list, roomNo, guestId) {
    const idx = list.findIndex(r => roomNoOf(r) === String(roomNo));
    if (idx < 0) return list;
    const r = { ...list[idx], occupied: true, status: "occupied", guestId };
    const next = [...list]; next[idx] = r; return next;
}
function freeRoom(list, roomNo) {
    const idx = list.findIndex(r => roomNoOf(r) === String(roomNo));
    if (idx < 0) return list;
    const r = { ...list[idx] };
    delete r.guestId;
    r.occupied = false; r.status = "vacant";
    const next = [...list]; next[idx] = r; return next;
}

/* Unified nights logic (used for T.Stays + finance) */
function nightsUnified(g) {
    const inISO = (g.checkInDate || "").slice(0, 10);
    const outISO = (g.checkOutDate || "").slice(0, 10);
    const st = String(g.status || "").toLowerCase();

    // ✅ If both dates exist and are the SAME day, count as 1 night
    if (inISO && outISO) {
        if (outISO === inISO) return 1;
        return diffNights(inISO, outISO);
    }
    if (inISO && st === "checked-in") return Math.max(1, diffNights(inISO, todayISO()));
    return 0;
}

/* Finance per guest — uses nightsUnified */
function computeFinance(D, g) {
    const gid = g?.id;
    const ordersAmt = (D.orders || []).filter(o => o.guestId === gid).reduce((s, o) => s + Number(o.amount || 0), 0);
    const paid = (D.payments || []).filter(p => p.guestId === gid).reduce((s, p) => s + Number(p.amount || 0), 0);

    const nights = nightsUnified(g);
    const room = nights * Number(g.roomRent || 0);
    const total = round2(room + ordersAmt);
    const due = round2(total - paid);
    return { nights, room, orders: ordersAmt, paid, total, due };
}

/* --- single-frame scheduler so we don't over-render --- */
let rafId = 0;
function schedule(fn) {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(fn);
}

/* ---------------- main view ---------------- */
export default async function view() {
    const host = document.createElement("section");
    host.className = "card";
    host.setAttribute("data-view", "inhouse");

    host.innerHTML = `
  <header class="view-header">
    <h2>In-House Guests</h2>
    <div class="filters">
      <input id="q" class="input sm" placeholder="Search by name / room / mobile…">
      <select id="f-status" class="input sm">
        <option value="">All</option>
        <option value="checked-in">Checked-In</option>
        <option value="arrival">Arrival</option>
      </select>
    </div>
  </header>

  <section class="panel">
    <div class="stats-row">
      <div class="stat tint-green">
        <div class="ico">🛏️</div>
        <div class="meta"><div class="t">Checked-In</div><div class="v" id="s-in">0</div></div>
      </div>
      <div class="stat tint-amber">
        <div class="ico">🧳</div>
        <div class="meta"><div class="t">Arrivals</div><div class="v" id="s-arr">0</div></div>
      </div>
      <div class="stat">
        <div class="ico">💰</div>
        <div class="meta"><div class="t">Total Bill</div><div class="v" id="s-bill">Rs 0</div></div>
      </div>
      <div class="stat">
        <div class="ico">💵</div>
        <div class="meta"><div class="t">Total Rec</div><div class="v" id="s-rec">Rs 0</div></div>
      </div>
      <div class="stat tint-red">
        <div class="ico">⚠️</div>
        <div class="meta"><div class="t">Total Dues</div><div class="v" id="s-due">Rs 0</div></div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="table mini">
        <thead>
          <tr>
            <th class="c col-sn">#</th>
            <th class="l">Guest</th>
            <th class="c">Status</th>
            <th class="l">Room</th>
            <th class="r">Rent</th>
            <th class="l">In</th>
            <th class="l">Out</th>
            <th class="r">T. Bill</th>
            <th class="r">T. Rec</th>
            <th class="r red">T. Dues</th>
            <th class="r">T. Stays</th>
            <th class="l col-actions">Action</th>
          </tr>
        </thead>
        <tbody id="rows"><tr><td colspan="12" class="tc muted">No in-house guests</td></tr></tbody>
      </table>
    </div>
  </section>

  <!-- Edit Modal -->
  <div class="modal" id="edit-modal" aria-hidden="true" role="dialog" aria-modal="true">
    <div class="modal-card" role="document">
      <div class="modal-head">
        <h3>Edit Guest</h3>
        <button class="btn xs ghost" id="m-close" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="fi"><label>Guest Name</label><input id="m-name" class="input"/></div>
          <div class="fi"><label>Mobile</label><input id="m-mobile" class="input"/></div>
          <div class="fi">
            <label>Status</label>
            <select id="m-status" class="input">
              <option value="arrival">Arrival</option>
              <option value="checked-in">Checked-In</option>
            </select>
            <small class="muted">Checked-In will occupy a room; Arrival frees it.</small>
          </div>
          <div class="fi"><label>Room</label><select id="m-room" class="input"></select><small class="muted">Available rooms first; occupied listed but disabled.</small></div>
          <div class="fi"><label>Room Rent</label><input id="m-rent" class="input" type="number" min="0" step="0.01"/></div>
          <div class="fi"><label>Check-In Date</label><input id="m-in" class="input" type="date"/></div>
          <div class="fi"><label>Check-Out Date</label><input id="m-out" class="input" type="date"/></div>
        </div>
        <div class="cardx">
          <div><strong>Finance</strong></div>
          <div class="mini-grid">
            <div>Total Bill: <span id="m-bill">Rs 0</span></div>
            <div>Total Received: <span id="m-rec">Rs 0</span></div>
            <div>Due: <span id="m-due" class="red">Rs 0</span></div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="m-save">Save</button>
        <button class="btn warn" id="m-checkout">Check Out</button>
      </div>
    </div>
    <div class="modal-backdrop" id="m-backdrop"></div>
  </div>
  `;

    const style = document.createElement("style");
    style.textContent = `
  [data-view="inhouse"]{
    --border:#e6e9ef; --muted:#717a8a; --ink:#0f172a;
    --surface:#ffffff; --soft:#f6f8fb; --shadow:0 6px 24px rgba(15,23,42,.06), 0 1px 4px rgba(15,23,42,.06);
    --green:#16a34a; --amber:#d97706; --red:#dc2626;
    --tint-green:#ecfdf5; --tint-amber:#fff7ed; --tint-red:#fef2f2;
  }
  .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f8fafc}
  .input.sm{height:36px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}

  .stats-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:10px}
  .stat{
    display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);
    background:#f9fafb;border-radius:12px;box-shadow:var(--shadow);
  }
  .stat .ico{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:#ffffff;border:1px solid var(--border)}
  .stat .t{font-size:12px;color:var(--muted)} .stat .v{font-weight:800;color:var(--ink)}
  .stat.tint-green .ico{background:var(--tint-green)}
  .stat.tint-amber .ico{background:var(--tint-amber)}
  .stat.tint-red .ico{background:var(--tint-red)}
  .stat.tint-red .v{color:var(--red)}

  .table.mini{width:100%;border-collapse:separate;border-spacing:0}
  .table.mini thead th{position:sticky;top:0;background:#f4f6fa;border-bottom:1px solid var(--border);padding:10px;text-align:left;font-weight:700}
  .table.mini td{padding:10px;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:middle}
  .table .col-actions{width:120px}
  .l{text-align:left}.r{text-align:right}.c{text-align:center}
  .tc{text-align:center}.muted{color:var(--muted)} .red{color:var(--red)}

  .guest-name{font-weight:600;color:#0f172a}

  /* tiny serial column (kept subtle; doesn't change layout) */
  .col-sn { width: 28px; }
  .table.mini td.col-sn, .table.mini th.col-sn {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
  .btn.xs{height:30px;padding:0 10px;border-radius:8px}
  .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .btn.ghost{background:#f5f7fb;border-color:#e6eaf2}
  .btn.warn{ background:#f59e0b; border-color:#d97706; color:#111827; font-weight:800; }
  .btn.warn:hover{ background:#fbbf24; }
  .btn:disabled,.btn[disabled]{ opacity:.45; cursor:not-allowed; }

  .modal{position:fixed;inset:0;display:none;z-index:9999}
  .modal[open]{display:block}
  .modal-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.45)}
  .modal-card{position:relative;margin:5vh auto 0;max-width:720px;width:96vw;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;max-height:92vh;box-shadow:0 20px 60px rgba(2,8,23,.25);z-index:1}
  .modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid var(--border)}
  .modal-body{padding:12px;overflow:auto;flex:1 1 auto}
  .modal-actions{position:sticky;bottom:0;padding:12px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:#fff;z-index:2}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .mini-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px}
  .cardx{border:1px solid var(--border);border-radius:12px;padding:10px;margin-top:10px;background:#f7f9fc}

  @media (max-width:1020px){ .stats-row{grid-template-columns:repeat(2,1fr)} }
  @media (max-width:620px){ .stats-row{grid-template-columns:1fr} .grid-2{grid-template-columns:1fr} .mini-grid{grid-template-columns:1fr} }
  `;
    host.appendChild(style);

    /* refs */
    const qs = s => host.querySelector(s);
    const q = qs("#q"), fStatus = qs("#f-status"), rows = qs("#rows");
    const sIn = qs("#s-in"), sArr = qs("#s-arr"), sBill = qs("#s-bill"), sRec = qs("#s-rec"), sDue = qs("#s-due");

    // modal refs
    const modal = qs("#edit-modal"), backdrop = qs("#m-backdrop"), mClose = qs("#m-close");
    const mName = qs("#m-name"), mMobile = qs("#m-mobile"), mStatus = qs("#m-status"),
        mRoom = qs("#m-room"), mRent = qs("#m-rent"), mIn = qs("#m-in"), mOut = qs("#m-out");
    const mBill = qs("#m-bill"), mRec = qs("#m-rec"), mDue = qs("#m-due");
    const mSave = qs("#m-save"), mCheckout = qs("#m-checkout");

    let currentId = null;
    let guardEdit = false;
    let guardCheckout = false;

    /* events */
    q.addEventListener("input", () => schedule(() => renderTableWith(ensure(getState()))));
    fStatus.addEventListener("change", () => schedule(() => renderTableWith(ensure(getState()))));
    mClose.addEventListener("click", closeModal);
    backdrop.addEventListener("click", closeModal);
    mSave.addEventListener("click", onSaveEdit);
    mCheckout.addEventListener("click", onDirectCheckout);
    [mStatus, mRoom, mRent, mIn, mOut, mName, mMobile].forEach(el => el.addEventListener("input", updateFinancePreview));
    mRoom.addEventListener("change", () => {
        const rate = Number(mRoom.selectedOptions[0]?.getAttribute("data-rate") || 0);
        if (!mRent.value || Number(mRent.value) === 0) mRent.value = rate;
    });

    // Re-render on state changes (deduped to once per frame)
    const unsub = store.subscribe?.(() => schedule(() => renderFullWith(ensure(getState()))));
    host.addEventListener("DOMNodeRemoved", () => unsub?.());

    renderFullWith(ensure(getState()));
    return host;

    /* ---------------- optimistic producers (no UI/layout change) ---------------- */
    function produceAfterEdit(Din) {
        const n = ensure(Din);
        const idx = (n.guests || []).findIndex(x => String(x.id) === String(currentId));
        if (idx < 0) return n;

        const before = n.guests[idx];
        const prevRoom = before.roomNo || "";

        const st = mStatus.value || "checked-in";
        const roomNo = (mRoom.value || "").trim() || prevRoom;
        const rent = Number(mRent.value || 0);

        const g = { ...before };
        g.name = mName.value || g.name;
        g.mobile = mMobile.value || g.mobile;
        g.status = st;
        g.roomNo = roomNo;
        g.roomRent = rent;
        g.checkInDate = (mIn.value || g.checkInDate || todayISO());
        g.checkOutDate = (mOut.value || "");

        let rooms = n.rooms;
        if (st === "checked-in") {
            if (prevRoom && prevRoom !== roomNo) rooms = freeRoom(rooms, prevRoom);
            if (roomNo) rooms = occupyRoom(rooms, roomNo, g.id);
            g.checkedOut = false;
        } else if (st === "arrival") {
            if (roomNo) rooms = freeRoom(rooms, roomNo);
            g.checkedOut = false;
        }

        const out = {
            ...n,
            rooms,
            guests: (() => { const arr = [...n.guests]; arr[idx] = g; return arr; })()
        };
        return out;
    }

    function produceAfterCheckout(Din) {
        const n = ensure(Din);
        const idx = (n.guests || []).findIndex(x => String(x.id) === String(currentId));
        if (idx < 0) return n;

        const g = { ...n.guests[idx] };
        g.checkedOut = true;
        g.status = "checked-out";
        g.checkOutDate = todayISO();
        g.checkOutTime = nowTime();

        const stays = [
            { id: `stay_${g.id}_${Date.now()}`, guestId: g.id, name: g.name || "", roomNo: g.roomNo || "", rate: g.roomRent || 0, checkIn: g.checkInDate || todayISO(), checkOut: g.checkOutDate },
            ...(n.stays || [])
        ];

        let rooms = n.rooms;
        if (g.roomNo) rooms = freeRoom(rooms, g.roomNo);

        const out = {
            ...n,
            rooms,
            stays,
            guests: (() => { const arr = [...n.guests]; arr[idx] = g; return arr; })()
        };
        return out;
    }

    /* ---------------- renders (D-aware for optimistic UI) ---------------- */
    function renderFullWith(D){ renderTableWith(D); renderStatsWith(D); }
    function renderStatsWith(D) {
        const active = (D.guests || []).filter(g => (g.status || "checked-in") !== "checked-out" && !g.checkedOut);
        const checkedIn = active.filter(g => String(g.status || "").toLowerCase() === "checked-in");
        const arrivals = active.filter(g => String(g.status || "").toLowerCase() === "arrival");

        sIn.textContent = String(checkedIn.length);
        sArr.textContent = String(arrivals.length);

        let bill = 0, rec = 0, due = 0;
        for (const g of active) {
            const fin = computeFinance(D, g);
            bill += fin.total; rec += fin.paid; due += fin.due;
        }
        sBill.textContent = money(bill);
        sRec.textContent = money(rec);
        sDue.textContent = money(due);
    }
    function renderFull(){ renderFullWith(ensure(getState())); }

    function renderTableWith(D) {
        const qv = (q.value || "").trim().toLowerCase();
        const fs = (fStatus.value || "").toLowerCase();

        const list = (D.guests || [])
            .filter(g => (g.status || "checked-in") !== "checked-out" && !g.checkedOut)
            .filter(g => fs ? (String(g.status || "").toLowerCase() === fs) : true)
            .filter(g => {
                if (!qv) return true;
                const blob = `${g.name || ""} ${g.mobile || ""} ${g.roomNo || ""}`.toLowerCase();
                return blob.includes(qv);
            })
            .sort((a, b) => (String(a.roomNo || "")).localeCompare(String(b.roomNo || "")) || (b.checkInDate || "").localeCompare(a.checkInDate || ""));

        rows.innerHTML = "";
        if (!list.length) {
            rows.innerHTML = `<tr><td colspan="12" class="tc muted">No in-house guests</td></tr>`;
            return;
        }

        const frag = document.createDocumentFragment();
        list.forEach((g, idx) => {
            const fin = computeFinance(D, g);
            const nights = nightsUnified(g);
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td class="col-sn">${idx + 1}</td>
        <td><span class="guest-name">${esc(g.name || "Guest")}</span></td>
        <td class="c">${statusBadge(g.status)}</td>
        <td class="l">${esc(g.roomNo || "")}</td>
        <td class="r">${money(g.roomRent || 0)}</td>
        <td class="l">${esc(fmtDate(g.checkInDate))}</td>
        <td class="l">${esc(fmtDate(g.checkOutDate))}</td>
        <td class="r">${money(fin.total)}</td>
        <td class="r">${money(fin.paid)}</td>
        <td class="r"><span class="red">${money(fin.due)}</span></td>
        <td class="r">${nights}</td>
        <td class="l"><button class="btn xs" data-edit="${esc(g.id)}">Edit</button></td>
      `;
            frag.appendChild(tr);
        });
        rows.appendChild(frag);
        rows.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openModal(btn.dataset.edit, D)));
    }

    function renderTable(){ renderTableWith(ensure(getState())); }

    function statusBadge(st) {
        const s = String(st || "checked-in").toLowerCase();
        const tone = s === "arrival" ? "var(--tint-amber)" : "var(--tint-green)";
        const col = s === "arrival" ? "var(--amber)" : "var(--green)";
        const text = s === "arrival" ? "Arrival" : "Checked-In";
        return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${tone};border:1px solid var(--border);color:${col};font-weight:700;min-width:88px;text-align:center">${esc(text)}</span>`;
    }

    /* ---------------- modal logic ---------------- */
    function openModal(id, Dopt) {
        const D = ensure(Dopt || getState());
        const g = (D.guests || []).find(x => String(x.id) === String(id));
        if (!g) return;

        currentId = g.id;

        const rooms = (D.rooms || []).slice();
        const avail = rooms.filter(r => !roomOcc(r) || roomNoOf(r) === g.roomNo);
        const busy = rooms.filter(r => roomOcc(r) && roomNoOf(r) !== g.roomNo);

        const opt = (r, disabled = false) => {
            const no = roomNoOf(r); const rate = roomRateOf(r);
            const label = disabled ? `${no} — occupied` : `${no} • ${rate ? "Rs " + rate : "no rate"}`;
            return `<option value="${esc(no)}" data-rate="${rate}" ${disabled ? "disabled" : ""}>${esc(label)}</option>`;
        };
        const availHTML = avail.length ? `<optgroup label="Available / Current">${avail.map(r => opt(r, false)).join("")}</optgroup>` : "";
        const busyHTML = busy.length ? `<optgroup label="Occupied">${busy.map(r => opt(r, true)).join("")}</optgroup>` : "";
        const mRoomSel = document.getElementById("m-room") || host.querySelector("#m-room");
        mRoomSel.innerHTML = `<option value="">— Select Room —</option>${availHTML}${busyHTML}`;

        mName.value = g.name || "";
        mMobile.value = g.mobile || "";
        mStatus.value = (g.status || "checked-in") === "arrival" ? "arrival" : "checked-in";
        mRoom.value = g.roomNo || "";
        mRent.value = Number(g.roomRent || 0);
        mIn.value = (g.checkInDate || todayISO()).slice(0, 10);
        mOut.value = (g.checkOutDate || "").slice(0, 10);

        const fin = computeFinance(D, g);
        mBill.textContent = money(fin.total);
        mRec.textContent = money(fin.paid);
        mDue.textContent = money(fin.due);

        mCheckout.disabled = ((g.status || "checked-in").toLowerCase() === "checked-out");

        modal.setAttribute("open", "");
        modal.setAttribute("aria-hidden", "false");
    }
    function closeModal() { currentId = null; modal.removeAttribute("open"); modal.setAttribute("aria-hidden", "true"); }
    function updateFinancePreview() {
        const D = ensure(getState());
        const g = (D.guests || []).find(x => String(x.id) === String(currentId));
        if (!g) return;

        const tmp = {
            ...g,
            name: mName.value || g.name,
            mobile: mMobile.value || g.mobile,
            status: mStatus.value || g.status,
            roomNo: mRoom.value || g.roomNo,
            roomRent: Number(mRent.value || g.roomRent || 0),
            checkInDate: mIn.value || g.checkInDate,
            checkOutDate: mOut.value || g.checkOutDate
        };
        const fin = computeFinance(D, tmp);
        mBill.textContent = money(fin.total);
        mRec.textContent = money(fin.paid);
        mDue.textContent = money(fin.due);
    }

    function onSaveEdit() {
        if (!currentId || guardEdit) return;
        const st = mStatus.value || "checked-in";
        const roomNo = (mRoom.value || "").trim();
        const rent = Number(mRent.value || 0);
        if (!roomNo && st === "checked-in") { alert("Room required for Checked-In"); return; }

        guardEdit = true; mSave.disabled = true;

        // Optimistic UI: compute next, render now, then commit to store.
        const curr = ensure(getState());
        const next = produceAfterEdit(curr);
        renderFullWith(next);
        try { store.flushNow?.(); } catch {}

        save(prev => produceAfterEdit(prev));

        // Release guard quickly and close
        setTimeout(() => { guardEdit = false; mSave.disabled = false; closeModal(); }, 60);
    }

    function onDirectCheckout() {
        if (!currentId || guardCheckout) return;
        if (!confirm("Check out this guest now?")) return;

        guardCheckout = true; mCheckout.disabled = true;

        // Optimistic UI
        const curr = ensure(getState());
        const next = produceAfterCheckout(curr);
        renderFullWith(next);
        try { store.flushNow?.(); } catch {}

        save(prev => produceAfterCheckout(prev));

        setTimeout(() => { guardCheckout = false; mCheckout.disabled = false; closeModal(); }, 60);
    }
}
