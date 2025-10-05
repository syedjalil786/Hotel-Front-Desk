// tabs/expenses.js — Expenses with fixed single-row toolbar + compact stats (no auto print)
import { store } from "../state.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const uid = () => Math.random().toString(36).slice(2, 10);

import { money } from "../state.js";

function ensureData(d) {
    const n = d ? { ...d } : {};
    ["guests", "orders", "payments", "expenses", "stays"].forEach(k => { if (!Array.isArray(n[k])) n[k] = []; });
    if (!n.settings) n.settings = {};
    return n;
}
function save(updater) {
    if (typeof store.update === "function") {
        store.update(prev => updater(ensureData(prev)));
    } else {
        const curr = ensureData(store.get?.()); const next = updater(curr);
        if (typeof store.set === "function") store.set(next);
        else if (typeof store.setState === "function") store.setState(next);
        else window.__APP_STATE__ = next;
    }
}
function csvEscape(v) { v = String(v ?? ""); if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`; return v; }
function download(name, text, type = "text/csv") {
    const a = document.createElement("a"); a.download = name; a.href = URL.createObjectURL(new Blob([text], { type }));
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

export default async function view() {
    const host = document.createElement("section");
    host.className = "card";
    host.setAttribute("data-view", "expenses");

    host.innerHTML = `
    <header class="view-header">
      <h2>Expenses</h2>
    </header>

    <!-- Toolbar -->
    <div class="x-toolbar">
      <!-- 1) Date Range -->
      <div class="x-block x-range">
        <label>Date</label>
        <div class="x-range-wrap">
          <input type="date" id="f-from" class="input sm">
          <span class="sep">to</span>
          <input type="date" id="f-to" class="input sm">
        </div>
      </div>

      <!-- 2) Category -->
      <div class="x-block x-cat">
        <label>Category</label>
        <select id="f-cat" class="input sm">
          <option value="">All</option>
          <option>Guest Expense</option>
          <option>G House Expense</option>
          <option>Boss Expenses</option>
          <option>Others</option>
        </select>
      </div>

      <!-- 3) Search (flex-grow) -->
      <div class="x-block x-search">
        <label>Search</label>
        <input id="f-q" class="input sm" placeholder="Title, notes…">
      </div>

      <!-- 4) Buttons (right aligned) -->
      <div class="x-actions">
        <button class="btn sm" id="btn-reset">Reset</button>
        <button class="btn sm primary" id="btn-csv">Export CSV</button>
      </div>

      <!-- Stats row under toolbar -->
      <div class="x-stats">
        <div><span id="stat-count">0</span> records</div>
        <div>Total: <strong id="stat-total">Rs 0.00</strong></div>
        <div>Guest: <span id="stat-guest">Rs 0.00</span></div>
        <div>House: <span id="stat-house">Rs 0.00</span></div>
        <div>Boss: <span id="stat-boss">Rs 0.00</span></div>
        <div>Others: <span id="stat-others">Rs 0.00</span></div>
      </div>
    </div>

    <!-- Add Expense -->
    <section class="panel">
      <div class="panel-head"><h3>Add Expense</h3></div>
      <div class="form-grid-3">
        <div class="fi">
          <label>Category</label>
          <select id="cat" class="input">
            <option>Guest Expense</option>
            <option>G House Expense</option>
            <option>Boss Expenses</option>
            <option>Others</option>
          </select>
        </div>
        <div class="fi">
          <label>Title</label>
          <input id="title" class="input" placeholder="Expense title">
        </div>
        <div class="fi">
          <label>Amount</label>
          <input id="amount" class="input" type="number" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="fi">
          <label>Date</label>
          <input id="date" class="input" type="date">
        </div>
        <div class="fi">
          <label>Time</label>
          <input id="time" class="input" type="time">
        </div>
        <div class="fi full">
          <label>Notes</label>
          <input id="notes" class="input" placeholder="Optional note">
        </div>
        <div class="fi full">
          <div class="btn-group">
            <button class="btn primary" id="btn-save">Add Expense</button>
            <button class="btn" id="btn-clear">Clear</button>
          </div>
        </div>
      </div>
    </section>

    <!-- List -->
    <section class="panel">
      <div class="panel-head"><h3>Expenses List</h3></div>
      <div class="table-wrap">
        <table class="table mini">
          <thead>
            <tr>
              <th>Date</th><th>Category</th><th>Title</th>
              <th class="r">Amount</th><th>Note</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="5" class="tc muted">No expenses</td></tr></tbody>
          <tfoot>
            <tr>
              <th colspan="3" class="r">Total (Filtered):</th>
              <th class="r" id="tot-amt">Rs 0.00</th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;

    /* ---------- styles: single-row grid that stays aligned ---------- */
    const style = document.createElement("style");
    style.textContent = `
    [data-view="expenses"]{--b:#e5e7eb;--mut:#6b7280}
    .x-toolbar{
      background:#fff;border:1px solid var(--b);border-radius:12px;padding:12px;box-shadow:0 2px 4px rgba(0,0,0,.04);margin-bottom:12px
    }
    /* main line: range | category | search (flex) | actions */
    .x-toolbar{
      display:grid;row-gap:10px
    }
    .x-toolbar>.x-stats{grid-column:1/-1}
    .filters-grid{display:contents}

    .x-toolbar{
      grid-template-columns: 460px 220px minmax(260px,1fr) auto;
      column-gap:12px; align-items:end
    }

    .x-block{display:flex;flex-direction:column;gap:4px}
    .x-block label{font-size:12px;color:var(--mut)}
    .x-range .x-range-wrap{display:flex;align-items:center;gap:8px}
    .x-range .sep{color:var(--mut);font-size:12px}
    .x-actions{display:flex;gap:8px;justify-self:end}
    .x-cat select{min-width:200px}
    .x-search input{min-width:260px}

    /* compact stats under the line */
    .x-stats{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:#374151;border-top:1px solid var(--b);padding-top:6px;margin-top:6px}
    .x-stats strong{color:#111827}

    .input{height:36px;padding:0 10px;border-radius:8px;border:1px solid var(--b);background:#f9fafb}
    .input.sm{height:34px}
    .btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--b);background:#fff;font-weight:700;cursor:pointer}
    .btn.primary{background:#2563eb;color:#fff;border-color:#2563eb}
    .panel{background:#fff;border:1px solid var(--b);border-radius:12px;padding:12px;box-shadow:0 2px 4px rgba(0,0,0,.04);margin-top:12px}
    .panel-head{display:flex;justify-content:space-between;align-items:center}
    .form-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .form-grid-3 .full{grid-column:1/-1}
    .tc{text-align:center}.r{text-align:right}

    /* responsive wrap */
    @media (max-width:1100px){
      .x-toolbar{grid-template-columns: minmax(360px,1fr) 200px minmax(220px,1fr) auto}
    }
    @media (max-width:880px){
      .x-toolbar{grid-template-columns: 1fr 1fr; }
      .x-actions{justify-self:start}
    }
    @media (max-width:560px){
      .x-toolbar{grid-template-columns: 1fr}
    }
  `;
    host.appendChild(style);

    // refs
    const qs = s => host.querySelector(s);
    const fromI = qs("#f-from"), toI = qs("#f-to"), fCatI = qs("#f-cat"), fQ = qs("#f-q"),
        btnReset = qs("#btn-reset"), btnCSV = qs("#btn-csv"),
        catI = qs("#cat"), titleI = qs("#title"), amtI = qs("#amount"),
        dateI = qs("#date"), timeI = qs("#time"), notesI = qs("#notes"),
        btnSave = qs("#btn-save"), btnClear = qs("#btn-clear"),
        rows = qs("#rows"), totAmt = qs("#tot-amt"),
        statCount = qs("#stat-count"), statTotal = qs("#stat-total"),
        statGuest = qs("#stat-guest"), statHouse = qs("#stat-house"),
        statBoss = qs("#stat-boss"), statOthers = qs("#stat-others");

    const t = todayISO(); fromI.value = t; toI.value = t; dateI.value = t; timeI.value = nowTime();

    [fromI, toI, fCatI, fQ].forEach(el => el.addEventListener("input", renderTable));
    btnReset.addEventListener("click", () => { fromI.value = t; toI.value = t; fCatI.value = ""; fQ.value = ""; renderTable(); });
    btnCSV.addEventListener("click", exportCSV);
    btnSave.addEventListener("click", onSave);
    btnClear.addEventListener("click", () => { titleI.value = ""; amtI.value = ""; notesI.value = ""; });

    const unsub = store.subscribe?.(() => renderTable());
    host.addEventListener("DOMNodeRemoved", () => unsub?.());

    renderTable();
    return host;

    /* -------- logic -------- */
    function onSave() {
        const cat = catI.value, title = titleI.value, amt = Number(amtI.value || 0);
        if (!title) { alert("Title required"); return; }
        if (!(amt > 0)) { alert("Amount must be >0"); return; }

        const exp = { id: uid(), date: dateI.value, time: timeI.value, cat, title, amount: round2(amt), note: notesI.value || "" };
        save(prev => { const n = ensureData(prev); n.expenses = [exp, ...n.expenses]; return n; });
        titleI.value = ""; amtI.value = ""; notesI.value = "";
        renderTable();
    }

    function filtered() {
        const D = ensureData(store.get?.());
        const from = (fromI.value || "0000-01-01").slice(0, 10),
              to = (toI.value || "9999-12-31").slice(0, 10),
              cat = fCatI.value,
              q = (fQ.value || "").toLowerCase();

        return (D.expenses || []).filter(e => {
            const d = (e.date || "").slice(0, 10);
            if (d < from || d > to) return false;
            if (cat && e.cat !== cat) return false;
            if (q && !(`${e.title} ${e.note}`.toLowerCase().includes(q))) return false;
            return true;
        });
    }

    function renderTable() {
        const list = filtered();

        rows.innerHTML = "";
        if (!list.length) {
            rows.innerHTML = `<tr><td colspan="5" class="tc muted">No expenses</td></tr>`;
        } else {
            const frag = document.createDocumentFragment();
            for (const e of list) {
                const tr = document.createElement("tr");
                tr.innerHTML = `
          <td>${esc((e.date || "").slice(0, 10))} ${esc(e.time || "")}</td>
          <td>${esc(e.cat || "")}</td>
          <td>${esc(e.title || "")}</td>
          <td class="r">${money(e.amount)}</td>
          <td>${esc(e.note || "")}</td>
        `;
                frag.appendChild(tr);
            }
            rows.appendChild(frag);
        }
        const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
        totAmt.textContent = money(total);

        // stats under toolbar
        statCount.textContent = list.length;
        statTotal.textContent = money(total);
        statGuest.textContent = money(list.filter(e => e.cat === "Guest Expense").reduce((s, e) => s + Number(e.amount || 0), 0));
        statHouse.textContent = money(list.filter(e => e.cat === "G House Expense").reduce((s, e) => s + Number(e.amount || 0), 0));
        statBoss.textContent  = money(list.filter(e => e.cat === "Boss Expenses").reduce((s, e) => s + Number(e.amount || 0), 0));
        statOthers.textContent = money(list.filter(e => e.cat === "Others").reduce((s, e) => s + Number(e.amount || 0), 0));
    }

    function exportCSV() {
        const list = filtered();
        const from = (fromI.value || "0000-01-01").slice(0, 10),
              to = (toI.value || "9999-12-31").slice(0, 10);
        const header = ["Date", "Time", "Category", "Title", "Amount", "Note", "ID"];
        const rowsCSV = list.map(e => [
            e.date || "", e.time || "", e.cat || "", e.title || "", Number(e.amount || 0).toFixed(2), e.note || "", e.id || ""
        ].map(csvEscape).join(","));
        download(`expenses_${from}_to_${to}.csv`, header.join(",") + "\n" + rowsCSV.join("\n"));
    }
}
