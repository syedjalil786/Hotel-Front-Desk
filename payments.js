// tabs/payments.js — Payments (in-house only) + compact filters + KPIs + updated print Invoice/Receipt
// Faster: immediate UI update, double-click guard, instant flush when available.

import { store } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const uid = () => Math.random().toString(36).slice(2, 10);
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
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [H,M] = String(hhmm).split(":");
  let h = Math.max(0, Number(H||0)), m = Math.max(0, Number(M||0));
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} ${ampm}`;
}

/* state guards */
function ensure(d) {
    const n = d ? { ...d } : {};
    ["guests", "orders", "payments", "expenses", "stays", "rooms"].forEach(k => { if (!Array.isArray(n[k])) n[k] = []; });
    n.settings ||= {};
    return n;
}
function getS() { try { if (typeof store?.get === "function") return store.get(); } catch { } return (window.__APP_STATE__ || {}); }
function save(updater) {
    if (typeof store?.update === "function") { store.update(prev => updater(ensure(prev))); return; }
    const next = updater(ensure(getS()));
    if (typeof store?.set === "function") store.set(next);
    else if (typeof store?.setState === "function") store.setState(next);
    else window.__APP_STATE__ = next;
}

/* money — no decimals */
function money(n) {
    try {
        const S = (getS().settings) || {};
        const code = S.currency || "PKR";
        const label = S.currencyLabel || "Rs";
        const loc = S.locale || "en-PK";
        const nf = new Intl.NumberFormat(loc, { style: "currency", currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 });
        let out = nf.format(Number(n || 0));
        const sym = nf.formatToParts(1).find(p => p.type === "currency")?.value || "";
        return sym ? out.replace(sym, label) : `${label} ${Math.round(Number(n || 0))}`;
    } catch { return "Rs " + Math.round(Number(n || 0)); }
}

/* finance */
function diffNights(aISO, bISO) {
    if (!aISO || !bISO) return 0;
    const a = new Date(aISO + "T00:00:00"), b = new Date(bISO + "T00:00:00");
    return Math.max(0, Math.floor((b - a) / 86400000));
}
function computeFinance(D, g) {
    const gid = g?.id;
    const ordAmt = (D.orders || []).filter(o => o.guestId === gid).reduce((s, o) => s + Number(o.amount || 0), 0);
    const paid = (D.payments || []).filter(p => p.guestId === gid).reduce((s, p) => s + Number(p.amount || 0), 0);
    const out = (g.checkOutDate && g.checkOutDate.slice(0, 10)) || todayISO();
    const nights = Math.max(1, diffNights((g.checkInDate || todayISO()).slice(0, 10), out));
    const room = nights * Number(g.roomRent || 0);
    const subtotal = round2(room + ordAmt);
    const discount = Number(g.discount || 0);
    const taxRate = Number((getS().settings || {}).taxRate || 0);
    const tax = round2((subtotal - discount) * (taxRate / 100));
    const grand = round2(subtotal - discount + tax);
    const balance = round2(grand - paid);
    return { nights, room, orders: ordAmt, subtotal, discount, tax, grand, paid, balance };
}

/* ---------------- main view ---------------- */
export default async function view() {
    const host = document.createElement("section");
    host.className = "card";
    host.setAttribute("data-view", "payments");

    host.innerHTML = `
  <header class="view-header">
    <h2>Payments</h2>
  </header>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="control range">
      <label>Date</label>
      <div class="range-fields">
        <input type="date" id="f-from" class="input sm">
        <span class="range-sep">to</span>
        <input type="date" id="f-to" class="input sm">
      </div>
    </div>

    <div class="control">
      <label>Method</label>
      <select id="f-method" class="input sm">
        <option value="">All Methods</option>
        <option>Cash</option><option>Card</option><option>Bank</option><option>Online</option>
      </select>
    </div>

    <div class="control grow">
      <label>Search</label>
      <input id="f-guest" class="input sm" placeholder="Guest, room, ref, method…">
    </div>

    <div class="control actions">
      <div class="btn-group tail">
        <button class="btn sm" id="btn-reset" title="Clear filters">Reset</button>
        <button class="btn sm" id="btn-print-sum" title="Print summary">Print</button>
        <button class="btn sm primary" id="btn-export" title="Export filtered">Export CSV</button>
      </div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-title">Payments (Filtered)</div><div class="kpi-value" id="kpi-pay">Rs 0</div></div>
    <div class="kpi"><div class="kpi-title">Count</div><div class="kpi-value" id="kpi-cnt">0</div></div>
    <div class="kpi"><div class="kpi-title">Avg / Payment</div><div class="kpi-value" id="kpi-avg">Rs 0</div></div>
  </div>

  <!-- Add Payment -->
  <section class="panel" id="pay-form">
    <div class="panel-head">
      <h3>Add Payment</h3>
      <span class="muted" id="tip-due">Pick a guest to see due</span>
    </div>

    <div class="form-grid-3">
      <div class="fi">
        <label>Guest (in-house only)</label>
        <select id="gSel" class="input"></select>
      </div>
      <div class="fi">
        <label>Room</label>
        <input id="room" class="input" placeholder="Room #" readonly>
      </div>
      <div class="fi">
        <label>Amount</label>
        <div class="inline">
          <input id="amount" class="input" type="number" min="0" step="1" placeholder="0">
          <button class="btn light" id="btn-fill-due" type="button">Pay Full Due</button>
        </div>
      </div>

      <div class="fi">
        <label>Date</label>
        <input id="date" class="input" type="date">
      </div>
      <div class="fi">
        <label>Time</label>
        <input id="time" class="input" type="time">
      </div>
      <div class="fi">
        <label>Method</label>
        <select id="method" class="input">
          <option>Cash</option><option>Card</option><option>Bank</option><option>Online</option>
        </select>
      </div>

      <div class="fi full">
        <label>Ref / Txn #</label>
        <input id="ref" class="input" placeholder="e.g. POS-123 / Bank Txn">
      </div>
      <div class="fi full">
        <label>Notes</label>
        <textarea id="notes" class="input" placeholder="Optional notes"></textarea>
      </div>
    </div>

    <div class="actions-bar">
      <button class="btn primary" id="btn-save">Add Payment</button>
      <button class="btn" id="btn-clear">Clear</button>
      <span class="badge amber" id="due-badge" style="display:none"></span>
      <span class="badge red" id="warn-over" style="display:none">Overpay?</span>
    </div>
  </section>

  <!-- List -->
  <section class="panel">
    <div class="panel-head">
      <h3>Payments List</h3>
      <div class="muted" id="sum-cap">—</div>
    </div>
    <div class="table-wrap">
      <table class="table mini">
        <thead>
          <tr>
            <th>Date</th><th>Guest</th><th>Room</th>
            <th class="r">Amount</th><th>Method</th><th>Reference</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody id="rows"><tr><td colspan="7" class="tc muted">No payments</td></tr></tbody>
        <tfoot>
          <tr>
            <th colspan="3" class="r">Total (Filtered):</th>
            <th class="r" id="tot-amt">Rs 0</th>
            <th colspan="3"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
  `;

    /* styles */
    const style = document.createElement("style");
    style.textContent = `
  [data-view="payments"]{ --border:#e5e7eb; --muted:#6b7280; --shadow:0 10px 30px rgba(2,8,23,.06),0 2px 8px rgba(2,8,23,.06); }
  .panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
  .panel-head{display:flex;justify-content:space-between;align-items:center}
  .toolbar{ position:sticky; top:58px; z-index:6; display:flex; align-items:end; gap:12px; flex-wrap:wrap; background:#fff;
            border:1px solid var(--border); border-radius:12px; padding:10px 12px; box-shadow:var(--shadow); margin-bottom:12px; }
  .control{display:flex;flex-direction:column;gap:6px;min-width:200px}
  .control.grow{flex:1 1 320px;min-width:260px}
  .control.range{min-width:320px}.range-fields{display:flex;align-items:center;gap:8px}.range-sep{color:var(--muted);font-size:12px}
  .control.actions{margin-left:auto;display:flex;align-items:center;gap:10px;min-width:260px}
  .input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f9fafb}
  .input.sm{height:38px}
  .btn{height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
  .btn.sm{height:38px;padding:0 12px;border-radius:8px}
  .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .btn:hover{background:#f8fafc}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;font-weight:700;font-size:12px}
  .badge.red{background:#fef2f2;color:#7f1d1d;border:1px solid #fecaca}
  .badge.amber{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
  .form-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .form-grid-3 .full{grid-column:1 / -1}
  .inline{display:flex;gap:8px;align-items:center}
  .table.mini thead th{position:sticky;top:0;background:#f8fafc;border-bottom:1px solid var(--border);padding:8px 10px;text-align:left}
  .table.mini td{padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
  .table .col-actions{width:160px}
  .kpi-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}
  .kpi{border:1px solid var(--border);border-radius:12px;padding:10px;background:#fff;box-shadow:var(--shadow)}
  .kpi-title{font-size:12px;color:var(--muted)} .kpi-value{font-weight:800}
  @media (max-width:980px){ .form-grid-3{grid-template-columns:1fr} .control,.control.range,.control.actions,.control.grow{flex:1 1 100%;min-width:100%} }
  `;
    host.appendChild(style);

    /* refs */
    const qs = s => host.querySelector(s);
    const fromI = qs("#f-from"), toI = qs("#f-to"), methodI = qs("#f-method"), searchI = qs("#f-guest");
    const resetBtn = qs("#btn-reset"), exportBtn = qs("#btn-export"), printSumBtn = qs("#btn-print-sum");
    const kPay = qs("#kpi-pay"), kCnt = qs("#kpi-cnt"), kAvg = qs("#kpi-avg");

    const gSel = qs("#gSel"), roomI = qs("#room"), dateI = qs("#date"), timeI = qs("#time"),
        methodP = qs("#method"), amountI = qs("#amount"), refI = qs("#ref"), notesI = qs("#notes"),
        fillDueBtn = qs("#btn-fill-due"), saveBtn = qs("#btn-save"), clearBtn = qs("#btn-clear"),
        tipDue = qs("#tip-due"), dueBadge = qs("#due-badge"), warnOver = qs("#warn-over");
    const rows = qs("#rows"), totAmt = qs("#tot-amt"), sumCap = qs("#sum-cap");

    const t = todayISO(); fromI.value = t; toI.value = t; dateI.value = t; timeI.value = nowTime();

    /* in-house guests only */
    function refreshGuests() {
        const D = ensure(getS());
        const guests = (D.guests || [])
            .filter(g => (g.status || "checked-in") !== "checked-out" && !g.checkedOut)
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        const sel = gSel.value;
        gSel.innerHTML = `<option value="">— Select Guest —</option>` + guests
            .map(g => `<option value="${esc(g.id)}">${esc(g.name || "Guest")} — Room ${esc(g.roomNo || "?")}</option>`).join("");
        if (sel && guests.find(x => x.id === sel)) gSel.value = sel;
        onGuestChange();
    }
    refreshGuests();

    function findGuest(D, id) { return (D.guests || []).find(g => String(g.id) === String(id)); }
    function computeDueFor(g) {
        const D = ensure(getS());
        const fin = computeFinance(D, g);
        return fin.balance;
    }

    function onGuestChange() {
        const D = ensure(getS());
        const g = findGuest(D, gSel.value);
        if (!g) { roomI.value = ""; tipDue.textContent = "Pick a guest to see due"; dueBadge.style.display = "none"; return; }
        roomI.value = g.roomNo || "";
        const due = computeDueFor(g);
        tipDue.textContent = `Due: ${money(due)} • Nights ${computeFinance(D, g).nights}`;
        dueBadge.style.display = "inline-flex";
        dueBadge.textContent = `Due: ${money(due)}`;
        onAmountInput();
    }

    /* events */
    gSel.addEventListener("change", onGuestChange);
    amountI.addEventListener("input", onAmountInput);
    function onAmountInput() {
        const D = ensure(getS()); const g = findGuest(D, gSel.value);
        if (!g) { warnOver.style.display = "none"; return; }
        const due = computeDueFor(g);
        const amt = Number(amountI.value || 0);
        warnOver.style.display = (amt > due) ? "inline-flex" : "none";
    }

    fillDueBtn.addEventListener("click", () => {
        const D = ensure(getS());
        const g = findGuest(D, gSel.value); if (!g) return;
        const due = computeDueFor(g);
        amountI.value = Math.max(0, Math.round(due)).toString();
        onAmountInput();
    });

    clearBtn.addEventListener("click", () => {
        gSel.value = ""; roomI.value = ""; dateI.value = t; timeI.value = nowTime();
        methodP.value = "Cash"; amountI.value = ""; refI.value = ""; notesI.value = "";
        warnOver.style.display = "none"; dueBadge.style.display = "none"; tipDue.textContent = "Pick a guest to see due";
    });

    // -------- FIX: Make add atomic, fast, and guard against double-clicks
    let busy = false;
    saveBtn.addEventListener("click", () => {
        if (busy) return;               // guard: ignore double taps
        const D = ensure(getS());
        const guest = findGuest(D, gSel.value);
        if (!guest) { alert("Please select a guest"); return; }
        const amt = Number(amountI.value || 0);
        if (!(amt > 0)) { alert("Amount must be greater than 0"); return; }
        const due = computeDueFor(guest);
        if (amt > due && !confirm(`This exceeds due (${money(due)}). Continue?`)) return;

        busy = true;
        saveBtn.disabled = true;

        const p = {
            id: uid(),
            date: dateI.value || t,
            time: timeI.value || nowTime(),
            guestId: guest.id,
            guestName: guest.name || "Guest",
            roomNo: guest.roomNo || "",
            amount: Math.round(amt),
            method: methodP.value || "Cash",
            ref: refI.value || "",
            notes: notesI.value || ""
        };

        // 1) Update local store synchronously (UI will re-render immediately via subscribe)
        save(prev => { const n = ensure(prev); n.payments = [p, ...(n.payments || [])]; return n; });

        // 2) Force a fast re-render right now (no waiting on debouncers / prints)
        renderTable(); updateKPI();

        // 3) Kick the cloud writer immediately if the store exposes it (non-blocking)
        try { store.flushNow?.(); } catch {}

        // 4) Clear the form and only then open the print window (let UI settle first)
        clearBtn.click();
        // let the browser paint the new row before opening a popup/print window
        setTimeout(() => { try { printReceipt(p); } catch {} }, 30);

        // 5) Re-enable
        setTimeout(() => { busy = false; saveBtn.disabled = false; }, 60);
    });

    /* filters */
    [fromI, toI, methodI, searchI].forEach(el => el.addEventListener("input", renderTable));
    resetBtn.addEventListener("click", () => { fromI.value = t; toI.value = t; methodI.value = ""; searchI.value = ""; renderTable(); });
    exportBtn.addEventListener("click", exportCSV);
    printSumBtn.addEventListener("click", printSummary);

    const unsub = store.subscribe?.(() => { refreshGuests(); renderTable(); updateKPI(); });
    host.addEventListener("DOMNodeRemoved", () => unsub?.());

    renderTable(); updateKPI();
    return host;

    /* ------------- list + kpis ------------- */
    function listFiltered(D) {
        const from = (fromI.value || "0000-01-01").slice(0, 10);
        const to = (toI.value || "9999-12-31").slice(0, 10);
        const meth = methodI.value || "";
        const q = (searchI.value || "").trim().toLowerCase();
        return (D.payments || []).filter(p => {
            const d = (p.date || "").slice(0, 10);
            if (from && d < from) return false;
            if (to && d > to) return false;
            if (meth && p.method !== meth) return false;
            if (q) {
                const blob = `${p.guestName || ""} ${p.roomNo || ""} ${p.ref || ""} ${p.method || ""}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }
    function renderTable() {
        const D = ensure(getS());
        const list = listFiltered(D);
        rows.innerHTML = "";
        if (!list.length) { rows.innerHTML = `<tr><td colspan="7" class="tc muted">No payments</td></tr>`; }
        else {
            const frag = document.createDocumentFragment();
            for (const p of list) {
                const tr = document.createElement("tr");
                tr.innerHTML = `
          <td>${fmtDate(p.date)} ${fmtTime(p.time)}</td>
          <td>${esc(p.guestName || "")}</td>
          <td>${esc(p.roomNo || "")}</td>
          <td class="r">${money(p.amount)}</td>
          <td>${esc(p.method || "")}</td>
          <td>${esc(p.ref || "")}</td>
          <td class="col-actions">
            <div class="btn-group">
              <button class="btn xs primary" data-act="receipt" data-id="${esc(p.id)}">Receipt</button>
              <button class="btn xs" data-act="invoice" data-id="${esc(p.id)}">Invoice</button>
              <button class="btn xs danger" data-act="delete" data-id="${esc(p.id)}">Delete</button>
            </div>
          </td>`;
                frag.appendChild(tr);
            }
            rows.appendChild(frag);
        }
        const total = list.reduce((s, p) => s + Number(p.amount || 0), 0);
        totAmt.textContent = money(total);
        sumCap.textContent = `${list.length} payment${list.length !== 1 ? 's' : ''} • ${money(total)}`;

        rows.querySelectorAll("[data-act]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = e.currentTarget.dataset.id, act = e.currentTarget.dataset.act;
                const pay = (getS().payments || []).find(x => x.id === id); if (!pay) return;
                if (act === "receipt") printReceipt(pay);
                else if (act === "invoice") printInvoice(pay);
                else if (act === "delete") {
                  if (confirm("Delete this payment? This cannot be undone.")) {
                    save(prev => { const n = ensure(prev); n.payments = (n.payments || []).filter(x => x.id !== pay.id); return n; });
                    // instant UI refresh
                    renderTable(); updateKPI();
                    try { store.flushNow?.(); } catch {}
                  }
                }
            });
        });

        updateKPI();
    }
    function updateKPI() {
        const D = ensure(getS());
        const list = listFiltered(D);
        const sum = list.reduce((s, p) => s + Number(p.amount || 0), 0);
        kPay.textContent = money(sum);
        kCnt.textContent = String(list.length);
        kAvg.textContent = list.length ? money(sum / list.length) : money(0);
    }

    function exportCSV() {
        const D = ensure(getS());
        const list = listFiltered(D);
        const header = ["Date", "Time", "Guest", "Room", "Amount", "Method", "Reference", "Notes", "ID"];
        const rowsCSV = list.map(p => [
            p.date || "", p.time || "", p.guestName || "", p.roomNo || "", Math.round(Number(p.amount || 0)).toString(),
            p.method || "", p.ref || "", (p.notes || "").replace(/\n/g, " "), p.id || ""
        ].map(v => /[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(","));
        const a = document.createElement("a");
        a.download = `payments_${(fromI.value || 'from')}_to_${(toI.value || 'to')}.csv`;
        a.href = URL.createObjectURL(new Blob([header.join(",") + "\n" + rowsCSV.join("\n")], { type: "text/csv" }));
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }

    function printSummary() {
        const D = ensure(getS());
        const list = listFiltered(D);
        const sum = list.reduce((s, p) => s + Number(p.amount || 0), 0);
        const html = `
    <html><head><meta charset="utf-8"><title>Payments Summary</title>
    <style>body{font:14px/1.35 system-ui,Segoe UI,Roboto,Arial;margin:20px;color:#0f172a}
    table{width:100%;border-collapse:collapse;margin-top:10px} th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}
    .r{text-align:right}</style></head><body>
    <h3>Payments Summary ${esc(fmtDate(fromI.value || ''))} → ${esc(fmtDate(toI.value || ''))}</h3>
    <table><thead><tr><th>Date</th><th>Guest</th><th>Room</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>
    ${list.map(p => `<tr>
        <td>${esc(fmtDate(p.date))} ${esc(fmtTime(p.time))}</td>
        <td>${esc(p.guestName || "")}</td>
        <td>${esc(p.roomNo || "")}</td>
        <td>${esc(p.method || "")}</td>
        <td class="r">${money(p.amount)}</td>
      </tr>`).join("") || `<tr><td colspan="5">No payments</td></tr>`
            }
    </tbody><tfoot><tr><th colspan="4" class="r">Total</th><th class="r">${money(sum)}</th></tr></tfoot></table>
    </body></html>`;
        const w = window.open("", "_blank"); if (!w) return;
        w.document.write(html); w.document.close();
    }

    /* ---------------- print templates ---------------- */

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

    function renderReceiptHTML(data) {
        const css = baseCSS(); const top = renderTop(css, "Receipt", data);
        return `
${top}
  <div class="docrow">
    <h1 class="doctitle">RECEIPT</h1>
    <div class="docmeta"><div><span class="muted">DATE:</span> ${esc(data.date || "")}</div></div>
  </div>

  <div class="invno muted">ROOM <span class="value">${esc(data.roomLabel || "")}</span></div>

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
      <div class="party-title">—</div>
      <div class="party-lines"><div></div></div>
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
    <div class="remarks"><div class="muted">—</div><div class="remarks-box"></div></div>
    <div class="totals">
      <div class="trow"><span>SUBTOTAL</span><span>${esc(data.subtotal)}</span></div>
      <div class="trow"><span>DISCOUNT</span><span>${esc(data.discount)}</span></div>
      <div class="trow"><span>TAX</span><span>${esc(data.totalTax)}</span></div>
      <div class="trow"><span>GRAND TOTAL</span><span>${esc(data.grandTotal)}</span></div>
      <div class="trow"><span>AMOUNT PAID</span><span>${esc(data.amountPaid)}</span></div>
      <div class="balance"><span>Balance</span><span>${esc(data.balance)}</span></div>
    </div>
  </div>
  <div class="fine">This receipt was generated by the system.</div>
</section>
</body></html>`;
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
        <div>Check-In: ${esc(data.stay?.inDate || "")} ${esc(data.stay?.inTime || "")}</div>
        <div>Check-Out: ${esc(data.stay?.outDate || "")} ${esc(data.stay?.outTime || "")}</div>
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

    /* build data for printing */
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
            subtotal: money(fin.subtotal),
            discount: money(fin.discount),
            subtotalLessDiscount: money(fin.subtotal - fin.discount),
            totalTax: money(fin.tax),
            grandTotal: money(fin.grand),
            amountPaid: money(fin.paid),
            balance: money(fin.balance),
            balanceDue: money(fin.balance),
            remarks: (S.invoiceFooter || "")
        };
    }

    function printReceipt(p) {
        const D = ensure(getS()); const S = D.settings || {};
        const g = (D.guests || []).find(x => x.id === p.guestId) || {};
        const fin = computeFinance(D, g);
        const items = [{
            description: `Payment received for Room ${g.roomNo || p.roomNo || "-"} (${fmtDate(p.date)} ${fmtTime(p.time)})`,
            qty: 1,
            unitPrice: money(p.amount),
            lineTotal: money(p.amount)
        }];
        const data = {
            ...buildCommon(S, g, fin, (g.roomNo || p.roomNo || "-")),
            date: fmtDate(p.date),
            items
        };
        const html = renderReceiptHTML(data);
        const w = window.open("", "_blank"); if (!w) return;
        w.document.write(html); w.document.close();
    }

    function printInvoice(p) {
        const D = ensure(getS()); const S = D.settings || {};
        const g = (D.guests || []).find(x => x.id === p.guestId) || {};
        const fin = computeFinance(D, g);

        const items = [];
        if (fin.room > 0) items.push({ description: `Room Rent (${fin.nights} night${fin.nights > 1 ? "s" : ""} @ ${money(g.roomRent || 0)})`, qty: fin.nights, unitPrice: money(g.roomRent || 0), lineTotal: money(fin.room) });
        if (fin.orders > 0) items.push({ description: `Orders / Services`, qty: 1, unitPrice: money(fin.orders), lineTotal: money(fin.orders) });
        if (fin.discount > 0) items.push({ description: `Discount`, qty: 1, unitPrice: money(-fin.discount), lineTotal: money(-fin.discount) });

        const data = {
            ...buildCommon(S, g, fin, (g.roomNo || p.roomNo || "-")),
            date: fmtDate(p.date),
            items,
            stay: {
                inDate: fmtDate(g.checkInDate), inTime: g.checkInTime || "",
                outDate: fmtDate(g.checkOutDate), outTime: g.checkOutTime || "",
                nights: fin.nights, persons: g.persons || 1
            }
        };
        const html = renderInvoiceHTML(data);
        const w = window.open("", "_blank"); if (!w) return;
        w.document.write(html); w.document.close();
    }
}
