// tabs/check-in.js — Check-In with Status (Checked-In/Arrival) + 1MB attachment
// Returning guests fixed: same-day = 1 night; proper Grand/Paid/Due per stay; DD-MM-YYYY in table.

import { store } from "../state.js";
import { money } from "../state.js";

/* ---------------- small helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => (
  { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]
));
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime   = () => new Date().toTimeString().slice(0, 5);
const uid       = () => Math.random().toString(36).slice(2, 10);
const round2    = n => Math.round(Number(n || 0) * 100) / 100;

/* ---- date helpers ---- */
function pad2(n){ return String(n).padStart(2,"0"); }
function fmtDateDDMY(iso){
  if (!iso) return "";
  const d = new Date((String(iso).slice(0,10)) + "T00:00:00");
  if (isNaN(d)) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()}`;
}
function diffNights(aISO, bISO){
  if (!aISO || !bISO) return 0;
  const a = new Date(aISO + "T00:00:00"), b = new Date(bISO + "T00:00:00");
  const days = Math.max(0, Math.floor((b - a) / 86400000)); // end-exclusive
  // ✅ same-day should count as 1 night
  return days === 0 ? 1 : days;
}
function dateOnly(iso){ return (String(iso||"").slice(0,10)); }
function inRangeInclusive(dISO, fromISO, toISO){
  const d = dateOnly(dISO);
  const f = dateOnly(fromISO);
  const t = dateOnly(toISO);
  if (!d || !f || !t) return false;
  return (d >= f && d <= t);
}

/* ---- time formatting for print labels ---- */
function to12h(hhmm) {
  const [hStr, mStr] = String(hhmm || "12:00").split(":");
  let h = Number(hStr || 12), m = (mStr ?? "00");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}
function formatCheckOutTime(hhmm) {
  const t = to12h(hhmm || "12:00");
  return t.startsWith("12:") ? `${t} (afternoon)` : t;
}

/* ---- state helpers ---- */
function getState(){ try{ if (typeof store?.get === "function") return store.get(); }catch{} return (window.__APP_STATE__ || {}); }
function ensure(d){
  const n = d ? { ...d } : {};
  for (const k of ["guests","orders","payments","expenses","stays","rooms"]) if (!Array.isArray(n[k])) n[k]=[];
  n.settings ||= {};
  return n;
}
function save(updater){
  if (typeof store?.update === "function"){ store.update(prev => updater(ensure(prev))); return; }
  const next = updater(ensure(getState()));
  if (typeof store?.set === "function") store.set(next);
  else if (typeof store?.setState === "function") store.setState(next);
  else window.__APP_STATE__ = next;
}

/* room helpers (tolerant) */
const roomNoOf   = r => String(r.number ?? r.no ?? r.roomNo ?? r.name ?? r.id ?? "").trim();
const roomRateOf = r => Number(r.rate ?? r.rent ?? r.price ?? r.tariff ?? r.amount ?? 0);
const roomOcc    = r => Boolean(r.occupied ?? r.isOccupied ?? r.busy ?? (r.status && String(r.status).toLowerCase() !== "vacant") ?? false);
function occupyRoom(list, roomNo, guestId){
  const i = list.findIndex(r => roomNoOf(r) === String(roomNo));
  if (i < 0) return list;
  const r = { ...list[i], occupied:true, status:"occupied", guestId };
  const next = [...list]; next[i]=r; return next;
}

/* small eye svg */
const eyeSVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

/* ---------------- main view ---------------- */
export default async function view() {
  const host = document.createElement("section");
  host.className = "card";
  host.setAttribute("data-view", "check-in");

  host.innerHTML = `
<header class="view-header">
  <h2>Check In</h2>
</header>

<section class="panel">
  <div class="form-grid-2">
    <div class="fi"><label>Guest Name</label><input id="name" class="input" placeholder="Guest Name"></div>
    <div class="fi"><label>Father's Name</label><input id="father" class="input" placeholder="Father's Name"></div>

    <div class="fi"><label>CNIC / Passport No.</label><input id="cnic" class="input" placeholder="ID Number"></div>
    <div class="fi"><label>Mobile No.</label><input id="mobile" class="input" placeholder="03XXXXXXXXX"></div>

    <div class="fi"><label>Persons</label><input id="persons" class="input" type="number" min="1" step="1" value="1"></div>
    <div class="fi"><label>Check-IN Date</label><input id="inDate" class="input" type="date"></div>

    <div class="fi"><label>Check-IN Time</label><input id="inTime" class="input" type="time"></div>
    <div class="fi"><label>Address</label><input id="address" class="input" placeholder="Address"></div>

    <div class="fi"><label>Company Name</label><input id="company" class="input" placeholder="Company (optional)"></div>
    <div class="fi"><label>Check-OUT Date</label><input id="outDate" class="input" type="date" placeholder="mm/dd/yyyy"></div>

    <div class="fi"><label>Check-OUT Time</label><input id="outTime" class="input" type="time" value="12:00"></div>

    <div class="fi">
      <label>Room Rent</label>
      <div class="inline">
        <input id="rent" class="input" type="number" min="0" step="1" value="0">
        <select id="status" class="input" style="max-width:220px">
          <option value="checked-in" selected>Checked-In</option>
          <option value="arrival">Arrival</option>
        </select>
      </div>
    </div>

    <div class="fi full">
      <label>Room No.</label>
      <select id="room" class="input"></select>
      <small class="muted">Vacant rooms are shown on top. Selecting a room fills room rent automatically.</small>
    </div>

    <div class="fi full">
      <label>Attachment</label>
      <div class="attach-row">
        <input id="file" type="file" accept=".jpg,.jpeg,.png,.pdf,.webp,.gif" style="display:none">
        <button class="btn" id="btn-attach" type="button">Attach File</button>
        <button class="btn" id="btn-open" type="button">Open File</button>
        <span id="file-cap" class="muted">No file attached</span>
      </div>
      <div class="max-note">Max size: <strong>1 MB</strong></div>
    </div>
  </div>

  <div class="actions-bar">
    <button class="btn primary" id="btn-save">Check In</button>
    <button class="btn" id="btn-clear">Clear</button>
    <button class="btn" id="btn-print">Print Form</button>
  </div>
</section>

<section class="panel">
  <div class="panel-head">
    <h3>Returning Guests</h3>
    <input id="searchRet" class="input sm" placeholder="Search by name or mobile…">
  </div>
  <div class="table-wrap">
    <table class="table mini">
      <thead>
        <tr>
          <th>Guest</th><th>Mobile</th><th>Last In</th><th>Last Out</th><th>Last Room</th>
          <th>Room Rent</th><th class="r">Grand</th><th class="r">Paid</th><th class="r red">Due</th><th>Attachment</th><th class="col-actions">Action</th>
        </tr>
      </thead>
      <tbody id="ret-rows"><tr><td colspan="11" class="tc muted">No records</td></tr></tbody>
    </table>
  </div>
</section>
`;

  const style = document.createElement("style");
  style.textContent = `
[data-view="check-in"]{ --border:#e5e7eb; --muted:#6b7280; --shadow:0 10px 30px rgba(2,8,23,.06),0 2px 8px rgba(2,8,23,.06); }
.panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
.form-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fi.full{grid-column:1 / -1}
.input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f9fafb}
.input.sm{height:36px}
.inline{display:flex;gap:8px;align-items:center}
.muted{color:var(--muted)}
.btn{height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.btn.xs{height:30px;padding:0 10px;border-radius:8px}
.btn.ghost{background:#f7f9ff;border-color:#e6eaf2}
.actions-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.table.mini thead th{background:#f8fafc;border-bottom:1px solid var(--border);padding:8px 10px;text-align:left}
.table.mini td{padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
.table .col-actions{width:140px}
.r{text-align:right}.tc{text-align:center}.red{color:#dc2626}
.attach-row{display:flex;gap:8px;align-items:center}
.max-note{margin-top:6px;font-size:12px;color:#b91c1c}
@media (max-width:980px){ .form-grid-2{grid-template-columns:1fr} }
`;
  host.appendChild(style);

  /* --------------- refs --------------- */
  const qs = s => host.querySelector(s);
  const nameI = qs("#name"), fatherI = qs("#father"), cnicI = qs("#cnic"), mobileI = qs("#mobile"),
        personsI = qs("#persons"), inDateI = qs("#inDate"), inTimeI = qs("#inTime"),
        addressI = qs("#address"), companyI = qs("#company"), outDateI = qs("#outDate"),
        outTimeI = qs("#outTime"), rentI = qs("#rent"), roomI = qs("#room"), statusI = qs("#status");

  const fileInput = qs("#file"), attachBtn = qs("#btn-attach"), openBtn = qs("#btn-open"), fileCap = qs("#file-cap");
  const saveBtn = qs("#btn-save"), clearBtn = qs("#btn-clear"), printBtn = qs("#btn-print");

  const searchRet = qs("#searchRet"), retRows = qs("#ret-rows");

  inDateI.value = todayISO();
  inTimeI.value = nowTime();
  outTimeI.value = "12:00"; // default checkout noon

  /* --------------- rooms list --------------- */
  function refreshRooms(){
    const D = ensure(getState());
    const rooms = (D.rooms || []).slice();
    const vacant = rooms.filter(r => !roomOcc(r));
    const busy   = rooms.filter(r =>  roomOcc(r));

    const opt = (r, disabled) => {
      const no = roomNoOf(r); const rate = roomRateOf(r);
      const label = disabled ? `${no} — occupied` : `${no} • ${rate ? ("Rs " + rate) : "no rate"}`;
      return `<option value="${esc(no)}" data-rate="${rate}" ${disabled ? "disabled" : ""}>${esc(label)}</option>`;
    };

    roomI.innerHTML = `<option value="">— Select Room —</option>`
      + (vacant.length ? `<optgroup label="Vacant">${vacant.map(r => opt(r, false)).join("")}</optgroup>` : "")
      + (busy.length   ? `<optgroup label="Occupied">${busy.map(r => opt(r, true)).join("")}</optgroup>`   : "");
  }
  refreshRooms();

  roomI.addEventListener("change", () => {
    const rate = Number(roomI.selectedOptions[0]?.getAttribute("data-rate") || 0);
    if (!rentI.value || Number(rentI.value) === 0) rentI.value = rate || 0;
  });

  /* --------------- attachment (<=1MB) --------------- */
  let attachment = null; // {name,type,dataURL,size}
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) { attachment = null; fileCap.textContent = "No file attached"; return; }
    if (f.size > 1024 * 1024) { alert("File too large. Max size is 1 MB."); fileInput.value = ""; attachment = null; fileCap.textContent = "No file attached"; return; }
    const dataURL = await fileToDataURL(f);
    attachment = { name: f.name, type: f.type, size: f.size, dataURL };
    fileCap.textContent = `${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  });
  openBtn.addEventListener("click", () => {
    if (!attachment) { alert("No file attached."); return; }
    const w = window.open("", "_blank");
    w.document.write(`<html><body style="margin:0"><embed src="${attachment.dataURL}" style="width:100%;height:100vh"/></body></html>`);
    w.document.close();
  });
  function fileToDataURL(file){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
  }

  /* --------------- returning guests (per-stay finance) --------------- */
  function renderReturning(){
    const D = ensure(getState());
    const q = (searchRet.value || "").trim().toLowerCase();

    // Build list from stays with proper finance:
    // Room = nights * rate (same-day => 1 night)
    // + Orders during stay (by date)
    // - Payments during stay (by date)
    const list = (D.stays || []).map(s => {
      const g = (D.guests || []).find(x => x.id === s.guestId) || {};
      const inISO  = dateOnly(s.checkIn);
      // guard: if no checkOut in record, treat as same-day 1 night
      const outISO = dateOnly(s.checkOut || s.checkIn || inISO);
      const nights = diffNights(inISO, outISO);
      const rate   = Number(s.rate || g.roomRent || 0);
      const room   = nights * rate;

      // orders and payments recorded for this guest within this stay window
      const ordersSum = (D.orders || [])
        .filter(o => String(o.guestId) === String(s.guestId) && inRangeInclusive(o.date, inISO, outISO))
        .reduce((sum,o) => sum + Number(o.amount || 0), 0);
      const paidSum = (D.payments || [])
        .filter(p => String(p.guestId) === String(s.guestId) && inRangeInclusive(p.date, inISO, outISO))
        .reduce((sum,p) => sum + Number(p.amount || 0), 0);

      const grand = round2(room + ordersSum);
      const due   = round2(grand - paidSum);

      return {
        id: s.guestId,
        name: s.name || g.name || "Guest",
        mobile: g.mobile || "",
        lastIn: inISO,
        lastOut: outISO,
        lastRoom: s.roomNo || "",
        roomRent: rate,
        grand, paid: paidSum, due,
        attachment: g.attachment ? 1 : 0,
        att: g.attachment
      };
    }).sort((a,b) => (b.lastIn || "").localeCompare(a.lastIn || ""));

    const filtered = q ? list.filter(x => `${x.name} ${x.mobile}`.toLowerCase().includes(q)) : list;

    retRows.innerHTML = "";
    if (!filtered.length) { retRows.innerHTML = `<tr><td colspan="11" class="tc muted">No records</td></tr>`; return; }

    const frag = document.createDocumentFragment();
    for (const x of filtered) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(x.name)}</td>
        <td>${esc(x.mobile)}</td>
        <td>${esc(fmtDateDDMY(x.lastIn))}</td>
        <td>${esc(fmtDateDDMY(x.lastOut))}</td>
        <td>${esc(x.lastRoom)}</td>
        <td>${money(x.roomRent)}</td>
        <td class="r">${money(x.grand)}</td>
        <td class="r">${money(x.paid)}</td>
        <td class="r red">${money(x.due)}</td>
        <td>
          ${x.attachment
            ? `<button class="btn xs ghost" data-view-att="${esc(x.id)}" title="View attachment" aria-label="View attachment">${eyeSVG}</button>`
            : "—"}
        </td>
        <td class="col-actions">
          <button class="btn xs" data-recheck="${esc(x.id)}">Re-Check In</button>
        </td>
      `;
      frag.appendChild(tr);
    }
    retRows.appendChild(frag);

    // view attachment
    retRows.querySelectorAll("[data-view-att]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.viewAtt;
        const g = (getState().guests || []).find(gg => String(gg.id) === String(id));
        if (!g?.attachment?.dataURL) { alert("No attachment found."); return; }
        const w = window.open("", "_blank");
        w.document.write(`<html><body style="margin:0"><embed src="${g.attachment.dataURL}" style="width:100%;height:100vh"/></body></html>`);
        w.document.close();
      });
    });

    // re-check in
    retRows.querySelectorAll("[data-recheck]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.recheck;
        const g = (getState().guests || []).find(gg => String(gg.id) === String(id));
        if (!g) { alert("Guest not found"); return; }
        // push data to form, including previous attachment
        nameI.value = g.name || "";
        fatherI.value = g.father || "";
        cnicI.value = g.cnic || "";
        mobileI.value = g.mobile || "";
        personsI.value = g.persons || 1;

        // new stay defaults
        inDateI.value = todayISO();
        inTimeI.value = nowTime();

        addressI.value = g.address || "";
        companyI.value = g.company || "";

        // do NOT reuse previous checkout; clear it
        outDateI.value = "";
        outTimeI.value = "12:00";

        rentI.value = g.roomRent || 0;
        roomI.value = g.roomNo || "";
        statusI.value = "checked-in";

        attachment = g.attachment || null;
        fileCap.textContent = attachment ? `${attachment.name || "attached file"}` : "No file attached";
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }
  renderReturning();
  searchRet.addEventListener("input", renderReturning);

  /* --------------- actions --------------- */
  clearBtn.addEventListener("click", clearForm);
  saveBtn.addEventListener("click", onSave);
  printBtn.addEventListener("click", () => printCheckInFromCurrentForm(host));

  function clearForm(){
    [nameI, fatherI, cnicI, mobileI, addressI, companyI].forEach(i => i.value = "");
    personsI.value = 1;
    inDateI.value = todayISO(); inTimeI.value = nowTime();
    outDateI.value = ""; outTimeI.value = "12:00";
    rentI.value = 0; roomI.value = "";
    statusI.value = "checked-in";
    attachment = null; fileCap.textContent = "No file attached";
  }

  function onSave(){
    const st = statusI.value || "checked-in";
    const haveRoom = Boolean((roomI.value || "").trim());
    if (st === "checked-in" && !haveRoom) { alert("Please select a room for Checked-In."); return; }

    const guest = {
      id: uid(),
      name: nameI.value?.trim() || "Guest",
      father: fatherI.value?.trim() || "",
      cnic: cnicI.value?.trim() || "",
      mobile: mobileI.value?.trim() || "",
      persons: Number(personsI.value || 1),
      checkInDate: inDateI.value || todayISO(),
      checkInTime: inTimeI.value || nowTime(),
      checkOutDate: outDateI.value || "",
      checkOutTime: outTimeI.value || "",
      address: addressI.value?.trim() || "",
      company: companyI.value?.trim() || "",
      roomNo: roomI.value || "",
      roomRent: round2(rentI.value || 0),
      status: st,
      checkedOut: false,
      attachment: attachment || null
    };

    save(prev => {
      const n = ensure(prev);
      n.guests = [guest, ...(n.guests || [])];
      if (st === "checked-in" && guest.roomNo) n.rooms = occupyRoom(n.rooms, guest.roomNo, guest.id);
      return n;
    });

    alert(st === "checked-in" ? "Guest checked in!" : "Arrival saved!");
    clearForm();
    renderReturning();
  }

  return host;
}

/* ---------------- printing: built-in Check-In Form (unchanged layout) ---------------- */
function printCheckInFromCurrentForm(host){
  const S = (getState().settings || {});
  const hotelName = S.hotelName || "Hotel Front Desk";
  const logo = S.logo || "";
  const address = S.address || "";
  const phone = S.phone || "";
  const today = new Date().toISOString().slice(0, 10);

  // grab inputs from current rendered form
  const nameI = host.querySelector("#name");
  const fatherI = host.querySelector("#father");
  const cnicI = host.querySelector("#cnic");
  const mobileI = host.querySelector("#mobile");
  const personsI = host.querySelector("#persons");
  const inDateI = host.querySelector("#inDate");
  const inTimeI = host.querySelector("#inTime");
  const addressI = host.querySelector("#address");
  const companyI = host.querySelector("#company");
  const outDateI = host.querySelector("#outDate");
  const outTimeI = host.querySelector("#outTime");
  const roomI = host.querySelector("#room");
  const rentI = host.querySelector("#rent");
  const statusI = host.querySelector("#status");

  const data = {
    logo,
    hotelName,
    address,
    phone,
    today,
    name: esc(nameI?.value || ""),
    fatherName: esc(fatherI?.value || ""),
    cnic: esc(cnicI?.value || ""),
    mobile: esc(mobileI?.value || ""),
    persons: esc(personsI?.value || "1"),
    checkInDate: esc(inDateI?.value || ""),
    checkInTime: esc(to12h(inTimeI?.value || "12:00")),
    addressText: esc(addressI?.value || ""),
    companyName: esc(companyI?.value || ""),
    checkOutDate: esc(outDateI?.value || ""),
    checkOutTime: esc(formatCheckOutTime(outTimeI?.value || "12:00")),
    roomNo: esc(roomI?.value || ""),
    roomRentMoney: esc(Number(rentI?.value || 0) ? `Rs ${Number(rentI.value)}` : "Rs 0"),
    status: esc((statusI?.value || "checked-in").toLowerCase()),
    attachmentName: "" // filled below if present
  };

  const fileCap = host.querySelector("#file-cap")?.textContent || "";
  if (fileCap && !/No file attached/i.test(fileCap)) data.attachmentName = esc(fileCap);

  const html = buildCheckInTemplateHTML(data);
  const w = window.open("", "_blank"); if (!w) return;
  w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 50);
}

function buildCheckInTemplateHTML(d){
  const safe = v => String(v ?? "");
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Check-In Form</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root{ --ink:#111; --muted:#6b7280; --border:#d1d5db; --accent:#111; --pad:12mm;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; }
    @page { size:A4; margin:0; }
    html,body{ height:100%; }
    body{ margin:0; background:#f5f7fb; color:var(--ink); font-family:var(--font);
      -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sheet{ width:210mm; min-height:297mm; background:#fff; margin:10mm auto; padding:var(--pad);
      box-shadow:0 2px 20px rgba(0,0,0,.07); display:flex; flex-direction:column; gap:10mm; }
    @media print { body{background:#fff;} .sheet{margin:0; box-shadow:none; page-break-after:always;} }

    .head{ display:flex; align-items:center; gap:14px; border-bottom:2px solid var(--ink); padding-bottom:8px; }
    .logo{ height:48px; width:auto; object-fit:contain; }
    .head h1{ font-size:18px; line-height:1.2; margin:0 0 4px 0; font-weight:700; letter-spacing:.2px; }
    .muted{ color:var(--muted); font-size:12px; }

    .meta{ display:flex; justify-content:flex-end; font-size:12px; color:#1f2937; }

    .section-title{ margin:0; font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:700;
      color:var(--accent); border-left:3px solid var(--accent); padding-left:8px; }

    table.details{ width:100%; border-collapse:collapse; font-size:13px; }
    .details th, .details td{ border:1px solid var(--border); padding:8px 10px; vertical-align:top; }
    .details th{ width:24%; background:#f8fafc; text-align:left; font-weight:600; color:#1f2937; }
    .details td{ width:26%; }

    .policy{ border:1px solid var(--border); border-radius:6px; padding:12px 14px; font-size:13px; }
    .policy h3{ margin:0 0 8px 0; font-size:14px; }
    .policy h4{ margin:10px 0 4px 0; font-size:13px; text-decoration:underline; }
    .policy ul{ margin:4px 0 0 18px; padding:0; }
    .policy li{ margin:4px 0; }
    .ack{ margin-top:10px; font-size:12px; color:#111; }

    .signs{ display:grid; grid-template-columns:1fr 1fr; gap:18px 24px; margin-top:8mm; }
    .signs .line{ height:36px; border-bottom:1.5px solid var(--ink); display:flex; align-items:flex-end; justify-content:center;
      font-size:12px; color:var(--muted); padding-bottom:6px; }
  </style>
</head>
<body>
  <section class="sheet">
    <div class="head">
      ${d.logo ? `<img class="logo" src="${safe(d.logo)}">` : ""}
      <div>
        <h1>${safe(d.hotelName || "Hotel Front Desk")} — Check-In Form</h1>
        <div class="muted">${safe(d.address)} ${d.phone ? "• " + safe(d.phone) : ""}</div>
      </div>
    </div>
    <table class="details">
      <tr><th>Guest Name</th><td>${safe(d.name)}</td><th>Father's Name</th><td>${safe(d.fatherName)}</td></tr>
      <tr><th>CNIC / Passport No.</th><td>${safe(d.cnic)}</td><th>Mobile No.</th><td>${safe(d.mobile)}</td></tr>
      <tr><th>Persons</th><td>${safe(d.persons)}</td><th>Check-IN Date</th><td>${safe(d.checkInDate)}</td></tr>
      <tr><th>Check-IN Time</th><td>${safe(d.checkInTime)}</td><th>Address</th><td>${safe(d.addressText)}</td></tr>
      <tr><th>Company Name</th><td>${safe(d.companyName)}</td><th>Check-OUT Date</th><td>${safe(d.checkOutDate)}</td></tr>
      <tr><th>Check-OUT Time</th><td>${safe(d.checkOutTime)}</td><th>Room No.</th><td>${safe(d.roomNo)}</td></tr>
      <tr><th>Room Rent</th><td>${safe(d.roomRentMoney)}</td><th>Status</th><td>${safe(d.status)}</td></tr>
      <tr><th>Attachment</th><td colspan="3">${safe(d.attachmentName || "")}</td></tr>
    </table>

    <div class="policy">
      <h3>${safe(d.hotelName || "Stayinn Rooms & Apartments")} House Rules</h3>
      <h4>Check-in/Check-out Policy</h4>
      <ul><li>Check-in time: 12:00 PM (noon) onwards</li><li>Check-out time: 11:00 AM – 12:00 PM (late check-out may incur a half-night charge)</li></ul>
      <h4>Payment Policy</h4>
      <ul><li>Advance payment is required at the time of check-in</li><li>Payment receipt will be provided upon request</li></ul>
      <h4>Guest Policy</h4>
      <ul><li>Unmarried couples are not allowed to stay together in the same room</li><li>Guests are responsible for their visitors and must ensure they comply with house rules</li></ul>
      <h4>Prohibited Items</h4>
      <ul><li>Alcohol and alcoholic beverages</li><li>Fire items (e.g., candles, lighters, etc.)</li><li>Weapons of any kind</li></ul>
      <h4>Room Policy</h4>
      <ul><li>Guests are responsible for any missing items from their room</li><li>Damages to the room or its contents will incur a charge, determined by management</li></ul>
      <h4>Additional Rules</h4>
      <ul><li>Smoking is not allowed inside the rooms (designated smoking areas are available)</li><li>Loud noise and disturbances are not allowed after 10:00 PM</li><li>Guests are responsible for keeping their room keys safe and secure</li><li>Management reserves the right to evict guests who fail to comply with house rules</li><li>Please report any issues or concerns to management promptly</li></ul>
      <p class="ack">By checking in, guests acknowledge that they have read, understood, and agreed to comply with these house rules.
        Management is not responsible for loss or damage to personal belongings.</p>
    </div>

    <div class="signs">
      <div class="line">Guest Signature</div>
      <div class="line">Manager / Receptionist Signature</div>
    </div>
  </section>
</body>
</html>
`;
}
