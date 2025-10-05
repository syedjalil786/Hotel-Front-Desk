// tabs/reports.js — Reports with guest, payments, and expenses summaries
// Types: In-House, Revenue, Check-Ins, Check-Outs, Same-Day Check-Outs, Payments, Expenses
// Deleted Guests view and any delete/restore/purge controls have been removed.

import { store } from "../state.js";
import { money } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );

const todayISO = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// DD-MM-YYYY display
const pad2 = (n) => String(n).padStart(2, "0");
function fmtDMY(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return "";
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function getState() {
  try {
    if (typeof store?.get === "function") return store.get();
  } catch {}
  return window.__APP_STATE__ || {};
}
function ensure(d) {
  const n = d ? { ...d } : {};
  for (const k of ["guests", "orders", "payments", "expenses", "stays", "rooms"])
    if (!Array.isArray(n[k])) n[k] = [];
  n.settings ||= {};
  return n;
}
function csvEscape(v) {
  v = String(v ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.download = name;
  a.href = URL.createObjectURL(new Blob([text], { type }));
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/* finance for guest-based reports */
function diffNights(aISO, bISO) {
  if (!aISO || !bISO) return 0;
  const a = new Date(aISO + "T00:00:00"),
    b = new Date(bISO + "T00:00:00");
  return Math.max(0, Math.floor((b - a) / 86400000));
}
function computeFinance(D, g) {
  const gid = g?.id;
  const ordersAmt = (D.orders || [])
    .filter((o) => o.guestId === gid)
    .reduce((s, o) => s + Number(o.amount || 0), 0);

  // Same-day check-in/out counts as 1 night
  const nights = Math.max(1, diffNights(g.checkInDate, g.checkOutDate || todayISO()));
  const room = nights * Number(g.roomRent || 0);
  const total = round2(room + ordersAmt);
  return { nights, room, orders: ordersAmt, total };
}

/* ---------------- main view ---------------- */
export default async function view() {
  const host = document.createElement("section");
  host.className = "card";
  host.setAttribute("data-view", "reports");

  host.innerHTML = `
    <header class="view-header">
      <h2>Reports</h2>
      <div class="filters">
        <label>Type</label>
        <select id="r-type" class="input sm">
          <option value="inhouse">In-House Guests</option>
          <option value="revenue">Revenue</option>
          <option value="checkins">Check-Ins</option>
          <option value="checkouts">Check-Outs</option>
          <option value="sameday">Same-Day Check-Outs</option>
          <option value="payments">Payments</option>
          <option value="expenses">Expenses</option>
        </select>
        <label>From</label><input type="date" id="r-from" class="input sm"/>
        <label>To</label><input type="date" id="r-to" class="input sm"/>
        <input type="search" id="r-search" class="input sm" placeholder="Search…">
        <button class="btn primary" id="r-run">Run</button>
        <button class="btn" id="r-print">Print</button>
        <button class="btn" id="r-csv">Export CSV</button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-head"><h3>Report Results</h3></div>
      <div class="table-wrap">
        <table class="table mini">
          <thead id="r-head"></thead>
          <tbody id="r-rows"><tr><td class="tc muted">No report yet</td></tr></tbody>
          <tfoot id="r-foot"></tfoot>
        </table>
      </div>
    </section>
  `;

  const style = document.createElement("style");
  style.textContent = `
    [data-view="reports"]{ --border:#e5e7eb; --muted:#6b7280; }
    .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .input{height:38px;padding:0 10px;border-radius:8px;border:1px solid var(--border);background:#f9fafb}
    .btn{height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
    .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
    .panel{background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:12px}
    .table{width:100%;border-collapse:separate;border-spacing:0}
    .table thead th{background:#f8fafc;border-bottom:1px solid var(--border);padding:6px 8px;text-align:left}
    .table td{padding:6px 8px;border-bottom:1px solid var(--border)}
    .r{text-align:right}.l{text-align:left}.tc{text-align:center}.muted{color:var(--muted)}
  `;
  host.appendChild(style);

  /* refs */
  const qs = (s) => host.querySelector(s);
  const typeI = qs("#r-type"),
    fromI = qs("#r-from"),
    toI = qs("#r-to"),
    searchI = qs("#r-search"),
    runBtn = qs("#r-run"),
    printBtn = qs("#r-print"),
    csvBtn = qs("#r-csv");
  const head = qs("#r-head"),
    rows = qs("#r-rows"),
    foot = qs("#r-foot");

  const t = todayISO();
  fromI.value = t;
  toI.value = t;

  runBtn.addEventListener("click", renderReport);
  printBtn.addEventListener("click", () => printReport(lastData));
  csvBtn.addEventListener("click", () => exportCSV(lastData));
  searchI.addEventListener("input", renderReport);
  typeI.addEventListener("change", renderReport);

  let lastData = { list: [], type: typeI.value, from: t, to: t };

  renderReport(); // initial

  function renderReport() {
    const D = ensure(getState());
    const type = typeI.value;
    const from = (fromI.value || "0000-01-01").slice(0, 10);
    const to = (toI.value || "9999-12-31").slice(0, 10);
    const q = (searchI.value || "").trim().toLowerCase();

    let list = [];
    if (type === "payments") {
      list = (D.payments || []).filter((p) => {
        const d = (p.date || "").slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
      if (q) {
        list = list.filter((p) =>
          `${p.guestName || ""} ${p.roomNo || ""} ${p.method || ""} ${p.ref || ""} ${p.notes || ""}`
            .toLowerCase()
            .includes(q)
        );
      }
    } else if (type === "expenses") {
      list = (D.expenses || []).filter((e) => {
        const d = (e.date || "").slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
      if (q) {
        list = list.filter((e) =>
          `${e.title || e.name || ""} ${e.category || ""} ${e.method || ""} ${e.notes || e.note || ""}`
            .toLowerCase()
            .includes(q)
        );
      }
    } else {
      const base = (D.guests || []).slice();
      if (type === "inhouse") {
        list = base.filter(
          (g) =>
            !g.checkedOut &&
            (g.checkInDate || "") <= to &&
            (g.checkOutDate || "9999-12-31") >= from
        );
      } else if (type === "checkins") {
        list = base.filter(
          (g) =>
            (g.checkInDate || "").slice(0, 10) >= from &&
            (g.checkInDate || "").slice(0, 10) <= to
        );
      } else if (type === "checkouts") {
        list = base.filter(
          (g) =>
            (g.checkOutDate || "").slice(0, 10) >= from &&
            (g.checkOutDate || "").slice(0, 10) <= to
        );
      } else if (type === "sameday") {
        // Same-day check-outs: check-out within range AND check-in date == check-out date
        list = base.filter((g) => {
          const inD = (g.checkInDate || "").slice(0, 10);
          const outD = (g.checkOutDate || "").slice(0, 10);
          return (
            !!inD &&
            !!outD &&
            outD >= from &&
            outD <= to &&
            inD === outD
          );
        });
      } else {
        // revenue (all guests intersecting range)
        list = base;
      }

      if (q) {
        list = list.filter((g) =>
          `${g.name || ""} ${g.roomNo || ""} ${g.mobile || ""}`
            .toLowerCase()
            .includes(q)
        );
      }
    }

    lastData = { list, type, from, to };

    rows.innerHTML = "";
    foot.innerHTML = "";
    head.innerHTML = "";

    if (!list.length) {
      rows.innerHTML = `<tr><td class="tc muted">No data</td></tr>`;
      return;
    }

    if (type === "payments") {
      head.innerHTML = `
        <tr>
          <th class="l">Date</th>
          <th class="l">Guest</th>
          <th class="l">Room</th>
          <th class="r">Amount</th>
          <th class="l">Method</th>
          <th class="l">Ref</th>
          <th class="l">Notes</th>
        </tr>
      `;
      let total = 0;
      const frag = document.createDocumentFragment();
      for (const p of list) {
        total += Number(p.amount || 0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(fmtDMY((p.date || "").slice(0,10)))} ${esc(p.time || "")}</td>
          <td>${esc(p.guestName || "")}</td>
          <td>${esc(p.roomNo || "")}</td>
          <td class="r">${money(p.amount)}</td>
          <td>${esc(p.method || "")}</td>
          <td>${esc(p.ref || "")}</td>
          <td>${esc(p.notes || "")}</td>
        `;
        frag.appendChild(tr);
      }
      rows.appendChild(frag);
      foot.innerHTML = `
        <tr>
          <th colspan="3" class="r">Count</th>
          <th class="r">${list.length}</th>
          <th class="r">Total</th>
          <th class="r" colspan="2">${money(total)}</th>
        </tr>
      `;
    } else if (type === "expenses") {
      head.innerHTML = `
        <tr>
          <th class="l">Date</th>
          <th class="l">Title</th>
          <th class="l">Category</th>
          <th class="r">Amount</th>
          <th class="l">Method</th>
          <th class="l">Notes</th>
        </tr>
      `;
      let total = 0;
      const frag = document.createDocumentFragment();
      for (const e of list) {
        total += Number(e.amount || 0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(fmtDMY((e.date || "").slice(0,10)))} ${esc(e.time || "")}</td>
          <td>${esc(e.title || e.name || "")}</td>
          <td>${esc(e.category || "")}</td>
          <td class="r">${money(e.amount)}</td>
          <td>${esc(e.method || "")}</td>
          <td>${esc(e.notes || e.note || "")}</td>
        `;
        frag.appendChild(tr);
      }
      rows.appendChild(frag);
      foot.innerHTML = `
        <tr>
          <th colspan="3" class="r">Count</th>
          <th class="r">${list.length}</th>
          <th class="r">Total</th>
          <th class="r">${money(total)}</th>
        </tr>
      `;
    } else {
      // guest-based tables (inhouse, checkins, checkouts, sameday, revenue)
      head.innerHTML = `
        <tr>
          <th class="l">Guest</th>
          <th class="l">Room</th>
          <th class="l">Check-In</th>
          <th class="l">Check-Out</th>
          <th class="r">Nights</th>
          <th class="r">Room Rent</th>
          <th class="r">Orders</th>
          <th class="r">Total</th>
        </tr>
      `;
      let totalNights = 0,
        totalRoom = 0,
        totalOrders = 0,
        grandTotal = 0;
      const frag = document.createDocumentFragment();
      for (const g of list) {
        const fin = computeFinance(ensure(getState()), g);
        totalNights += fin.nights;
        totalRoom += fin.room;
        totalOrders += fin.orders;
        grandTotal += fin.total;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="l">${esc(g.name || "Guest")}</td>
          <td class="l">${esc(g.roomNo || "")}</td>
          <td class="l">${esc(fmtDMY((g.checkInDate || "").slice(0, 10)))}</td>
          <td class="l">${esc(fmtDMY((g.checkOutDate || "").slice(0, 10)))}</td>
          <td class="r">${fin.nights}</td>
          <td class="r">${money(fin.room)}</td>
          <td class="r">${money(fin.orders)}</td>
          <td class="r">${money(fin.total)}</td>
        `;
        frag.appendChild(tr);
      }
      rows.appendChild(frag);
      foot.innerHTML = `
        <tr>
          <th colspan="4" class="r">Totals</th>
          <th class="r">${totalNights}</th>
          <th class="r">${money(totalRoom)}</th>
          <th class="r">${money(totalOrders)}</th>
          <th class="r">${money(grandTotal)}</th>
        </tr>
      `;
    }
  }

  /* ---------------- print / csv ---------------- */
  function typeLabel(val) {
    switch (val) {
      case "inhouse": return "In-House Guests";
      case "revenue": return "Revenue";
      case "checkins": return "Check-Ins";
      case "checkouts": return "Check-Outs";
      case "sameday": return "Same-Day Check-Outs";
      case "payments": return "Payments";
      case "expenses": return "Expenses";
      default: return val;
    }
  }

  function printReport(data) {
    if (!data.list.length) return alert("No data to print");

    const D = ensure(getState());
    let thead = "";
    let rowsHTML = "";
    let tfoot = "";

    if (data.type === "payments") {
      let total = 0;
      rowsHTML = data.list
        .map((p) => {
          total += Number(p.amount || 0);
          return `<tr>
            <td>${esc(fmtDMY((p.date || "").slice(0,10)))} ${esc(p.time || "")}</td>
            <td>${esc(p.guestName || "")}</td>
            <td>${esc(p.roomNo || "")}</td>
            <td style="text-align:right">${money(p.amount)}</td>
            <td>${esc(p.method || "")}</td>
            <td>${esc(p.ref || "")}</td>
            <td>${esc(p.notes || "")}</td>
          </tr>`;
        })
        .join("");
      thead = `<tr>
        <th>Date</th><th>Guest</th><th>Room</th><th class="r">Amount</th>
        <th>Method</th><th>Ref</th><th>Notes</th>
      </tr>`;
      tfoot = `<tr>
        <th colspan="3" class="r">Count</th><th class="r">${data.list.length}</th>
        <th class="r">Total</th><th class="r" colspan="2">${money(total)}</th>
      </tr>`;
    } else if (data.type === "expenses") {
      let total = 0;
      rowsHTML = data.list
        .map((e) => {
          total += Number(e.amount || 0);
          return `<tr>
            <td>${esc(fmtDMY((e.date || "").slice(0,10)))} ${esc(e.time || "")}</td>
            <td>${esc(e.title || e.name || "")}</td>
            <td>${esc(e.category || "")}</td>
            <td style="text-align:right">${money(e.amount)}</td>
            <td>${esc(e.method || "")}</td>
            <td>${esc(e.notes || e.note || "")}</td>
          </tr>`;
        })
        .join("");
      thead = `<tr>
        <th>Date</th><th>Title</th><th>Category</th><th class="r">Amount</th><th>Method</th><th>Notes</th>
      </tr>`;
      tfoot = `<tr>
        <th colspan="3" class="r">Count</th><th class="r">${data.list.length}</th>
        <th class="r">Total</th><th class="r">${money(total)}</th>
      </tr>`;
    } else {
      let totalNights = 0,
        totalRoom = 0,
        totalOrders = 0,
        grandTotal = 0;
      rowsHTML = data.list
        .map((g) => {
          const fin = computeFinance(D, g);
          totalNights += fin.nights;
          totalRoom += fin.room;
          totalOrders += fin.orders;
          grandTotal += fin.total;
          return `<tr>
            <td>${esc(g.name || "Guest")}</td>
            <td>${esc(g.roomNo || "")}</td>
            <td>${esc(fmtDMY((g.checkInDate || "").slice(0, 10)))}</td>
            <td>${esc(fmtDMY((g.checkOutDate || "").slice(0, 10)))}</td>
            <td style="text-align:right">${fin.nights}</td>
            <td style="text-align:right">${money(fin.room)}</td>
            <td style="text-align:right">${money(fin.orders)}</td>
            <td style="text-align:right">${money(fin.total)}</td>
          </tr>`;
        })
        .join("");
      thead = `<tr>
        <th>Guest</th><th>Room</th><th>Check-In</th><th>Check-Out</th>
        <th class="r">Nights</th><th class="r">Room Rent</th><th class="r">Orders</th><th class="r">Total</th>
      </tr>`;
      tfoot = `<tr>
        <th colspan="4" class="r">Totals</th>
        <th class="r">${totalNights}</th>
        <th class="r">${money(totalRoom)}</th>
        <th class="r">${money(totalOrders)}</th>
        <th class="r">${money(grandTotal)}</th>
      </tr>`;
    }

    const styles = `
      <style>
        body{font:14px/1.4 system-ui,Segoe UI,Roboto,Arial;margin:20px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px}
        .muted{color:#6b7280;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{padding:8px;border:1px solid #e5e7eb;text-align:left}
        th.r, td.r{ text-align:right }
        thead th{background:#f8fafc}
        tfoot td, tfoot th{font-weight:800;background:#fafafa}
        @media print { .no-print{display:none} body{margin:0;padding:16px} }
      </style>
    `;
    const html = `
      ${styles}
      <h1>Report: ${esc(typeLabel(data.type))}</h1>
      <div class="muted">Period: ${esc(fmtDMY(data.from))} → ${esc(fmtDMY(data.to))}</div>
      <table>
        <thead>${thead}</thead>
        <tbody>${rowsHTML || `<tr><td>No data</td></tr>`}</tbody>
        <tfoot>${tfoot}</tfoot>
      </table>
      <script>window.print()</script>
    `;
    const w = window.open("", "_blank");
    w.document.write(`<html><head><meta charset="utf-8"><title>Report</title></head><body>${html}</body></html>`);
    w.document.close();
  }

  function exportCSV(data) {
    if (!data.list.length) return alert("No data to export");

    if (data.type === "payments") {
      const header = ["Date", "Time", "Guest", "Room", "Amount", "Method", "Ref", "Notes", "ID"];
      const body = data.list.map((p) =>
        [
          (p.date || "").slice(0, 10), // keep ISO for CSV
          p.time || "",
          p.guestName || "",
          p.roomNo || "",
          round2(p.amount),
          p.method || "",
          p.ref || "",
          (p.notes || "").replace(/\n/g, " "),
          p.id || "",
        ]
          .map(csvEscape)
          .join(",")
      );
      const total = data.list.reduce((s, p) => s + Number(p.amount || 0), 0);
      const totalsRow = ["Count", data.list.length, "", "", round2(total), "", "", "", ""]
        .map(csvEscape)
        .join(",");
      download(`report_payments_${data.from}_to_${data.to}.csv`, header.join(",") + "\n" + body.join("\n") + "\n" + totalsRow);
      return;
    }

    if (data.type === "expenses") {
      const header = ["Date", "Time", "Title", "Category", "Amount", "Method", "Notes", "ID"];
      const body = data.list.map((e) =>
        [
          (e.date || "").slice(0, 10),
          e.time || "",
          e.title || e.name || "",
          e.category || "",
          round2(e.amount),
          e.method || "",
          (e.notes || e.note || "").replace(/\n/g, " "),
          e.id || "",
        ]
          .map(csvEscape)
          .join(",")
      );
      const total = data.list.reduce((s, e) => s + Number(e.amount || 0), 0);
      const totalsRow = ["Count", data.list.length, "", "", round2(total), "", "", ""]
        .map(csvEscape)
        .join(",");
      download(`report_expenses_${data.from}_to_${data.to}.csv`, header.join(",") + "\n" + body.join("\n") + "\n" + totalsRow);
      return;
    }

    // guest-based CSV (inhouse, checkins, checkouts, sameday, revenue)
    const D = ensure(getState());
    const header = ["Guest", "Room", "Check-In", "Check-Out", "Nights", "Room Rent", "Orders", "Total"];
    const body = data.list.map((g) => {
      const fin = computeFinance(D, g);
      return [
        g.name || "Guest",
        g.roomNo || "",
        (g.checkInDate || "").slice(0, 10),  // keep ISO for CSV
        (g.checkOutDate || "").slice(0, 10), // keep ISO for CSV
        fin.nights,
        round2(fin.room),
        round2(fin.orders),
        round2(fin.total),
      ]
        .map(csvEscape)
        .join(",");
    });

    let totalNights = 0,
      totalRoom = 0,
      totalOrders = 0,
      grandTotal = 0;
    data.list.forEach((g) => {
      const f = computeFinance(D, g);
      totalNights += f.nights;
      totalRoom += f.room;
      totalOrders += f.orders;
      grandTotal += f.total;
    });
    const totalsRow = [
      "Totals",
      "",
      "",
      "",
      totalNights,
      round2(totalRoom),
      round2(totalOrders),
      round2(grandTotal),
    ]
      .map(csvEscape)
      .join(",");

    download(
      `report_${data.type}_${data.from}_to_${data.to}.csv`,
      header.join(",") + "\n" + body.join("\n") + "\n" + totalsRow
    );
  }

  return host;
}
