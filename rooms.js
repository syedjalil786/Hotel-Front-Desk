// tabs/rooms.js — Rooms manager with bulletproof modals + multi-room assignment
import { store } from "../state.js";

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

function getState() { try { if (typeof store?.get === "function") return store.get(); } catch { } return (window.__APP_STATE__ || {}); }
function ensure(d) {
    const n = d ? { ...d } : {};
    for (const k of ["rooms", "guests"]) if (!Array.isArray(n[k])) n[k] = [];
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
const uid = () => "room_" + Math.random().toString(36).slice(2, 10);

// consistent getters
const roomNoOf = r => String(r.number ?? r.no ?? r.roomNo ?? r.name ?? r.id ?? "").trim();
const roomRateOf = r => Number(r.rate ?? r.rent ?? r.price ?? r.tariff ?? r.amount ?? 0);
const roomOcc = r => Boolean(r.occupied ?? r.isOccupied ?? r.busy ?? (r.status && String(r.status).toLowerCase() !== "vacant") ?? false);

// room state mutations
function occupyRoom(list, roomNo, guestId) {
    const i = list.findIndex(r => roomNoOf(r) === String(roomNo));
    if (i < 0) return list;
    const r = { ...list[i], occupied: true, status: "occupied", guestId };
    const next = [...list]; next[i] = r; return next;
}
function freeRoom(list, roomNo) {
    const i = list.findIndex(r => roomNoOf(r) === String(roomNo));
    if (i < 0) return list;
    const r = { ...list[i] };
    delete r.guestId; r.occupied = false; r.status = "vacant";
    const next = [...list]; next[i] = r; return next;
}
function upsertRoom(list, oldNo, no, rate) {
    const i = list.findIndex(r => roomNoOf(r) === String(oldNo || no));
    if (i >= 0) {
        const old = { ...list[i] };
        const updated = { ...old, number: no, rate: Number(rate || 0) };
        const next = [...list]; next[i] = updated; return next;
    }
    return [...list, { id: uid(), number: no, rate: Number(rate || 0), occupied: false, status: "vacant" }];
}
function updateGuestAggregate(n, guestId) {
    const gi = (n.guests || []).findIndex(g => String(g.id) === String(guestId));
    if (gi < 0) return n;
    const g = { ...n.guests[gi] };
    const current = Array.isArray(g.rooms)
        ? g.rooms.slice()
        : (g.roomNo ? String(g.roomNo).split("/").map(s => s.trim()).filter(Boolean) : []);
    g.rooms = Array.from(new Set(current));
    g.roomNo = g.rooms.join("/");
    g.roomMultiplier = g.rooms.length || 0;
    n.guests = [...n.guests]; n.guests[gi] = g;
    return n;
}
function attachRoomsToGuest(n, guestId, roomNos) {
    const gi = (n.guests || []).findIndex(g => String(g.id) === String(guestId));
    if (gi < 0) return n;
    const g = { ...n.guests[gi] };
    const base = Array.isArray(g.rooms) ? g.rooms.slice() : (g.roomNo ? String(g.roomNo).split("/").map(s => s.trim()).filter(Boolean) : []);
    const nextRooms = Array.from(new Set(base.concat(roomNos.map(String))));
    g.rooms = nextRooms;
    g.roomNo = nextRooms.join("/");
    g.roomMultiplier = nextRooms.length || 0;
    n.guests = [...n.guests]; n.guests[gi] = g;

    // mark rooms
    let rms = (n.rooms || []).slice();
    for (const no of roomNos) rms = occupyRoom(rms, no, g.id);
    n.rooms = rms;
    return n;
}
function detachRoomFromGuest(n, guestId, roomNo) {
    const gi = (n.guests || []).findIndex(g => String(g.id) === String(guestId));
    if (gi < 0) return n;
    const g = { ...n.guests[gi] };
    const curr = Array.isArray(g.rooms) ? g.rooms.slice()
        : (g.roomNo ? String(g.roomNo).split("/").map(s => s.trim()).filter(Boolean) : []);
    const next = curr.filter(no => String(no) !== String(roomNo));
    g.rooms = next; g.roomNo = next.join("/"); g.roomMultiplier = next.length || 0;
    n.guests = [...n.guests]; n.guests[gi] = g;
    n.rooms = freeRoom((n.rooms || []), roomNo);
    return n;
}

/* ---------------- main view ---------------- */
export default async function view() {
    const host = document.createElement("section");
    host.className = "card";
    host.setAttribute("data-view", "rooms");

    host.innerHTML = `
    <header class="view-header">
      <h2>Rooms</h2>
      <div class="tools">
        <input id="q" class="input sm" placeholder="Search room / guest…">
        <button class="btn" id="btn-assign">Assign Rooms</button>
        <button class="btn primary" id="btn-add">+ Add Room</button>
      </div>
    </header>

    <section class="panel">
      <div class="table-wrap">
        <table class="table mini">
          <thead>
            <tr>
              <th>Room</th><th class="r">Rate</th><th>Status</th><th>Guest</th><th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="5" class="tc muted">No rooms</td></tr></tbody>
        </table>
      </div>
    </section>

    <!-- Add/Edit Room Modal -->
    <div class="modal" id="rm-modal">
      <div class="modal-card">
        <div class="modal-head">
          <h3 id="rm-title">Add Room</h3>
          <button class="btn xs ghost" id="rm-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="grid-2">
            <div class="fi">
              <label>Room No</label>
              <input id="rm-no" class="input" placeholder="e.g. 101">
            </div>
            <div class="fi">
              <label>Rate / Night</label>
              <input id="rm-rate" class="input" type="number" min="0" step="0.01" placeholder="e.g. 5000">
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn primary" id="rm-save">Save</button>
        </div>
      </div>
      <div class="modal-backdrop" id="rm-backdrop"></div>
    </div>

    <!-- Assign Rooms Modal -->
    <div class="modal" id="as-modal">
      <div class="modal-card">
        <div class="modal-head">
          <h3>Assign Rooms to Guest</h3>
          <button class="btn xs ghost" id="as-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="fi">
            <label>Guest (Checked-In / Arrival)</label>
            <select id="as-guest" class="input"></select>
          </div>
          <div class="fi">
            <label>Select Rooms</label>
            <select id="as-rooms" class="input" multiple size="10"></select>
            <small class="muted">Tip: hold CTRL/CMD for multi-select</small>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn primary" id="as-save">Assign</button>
        </div>
      </div>
      <div class="modal-backdrop" id="as-backdrop"></div>
    </div>
  `;

    /* ---------------- styles ---------------- */
    const style = document.createElement("style");
    style.textContent = `
  [data-view="rooms"]{ --border:#e5e7eb; --muted:#6b7280; --shadow:0 10px 30px rgba(2,8,23,.06),0 2px 8px rgba(2,8,23,.06); }
  .tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:#f9fafb}
  .input.sm{height:36px}
  .btn{height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:#fff;font-weight:700;cursor:pointer}
  .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .btn.xs{height:28px;padding:0 8px}
  .btn.ghost{background:#f7f9ff;border-color:#e6eaf2}
  .panel{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:12px;margin-top:12px}
  .table.mini thead th{background:#f8fafc;border-bottom:1px solid var(--border);padding:8px 10px;text-align:left}
  .table.mini td{padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
  .table .col-actions{width:210px}
  .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:#f8fafc;font-weight:700}
  .ok{color:#16a34a}.danger{color:#dc2626}.muted{color:var(--muted)}.r{text-align:right}.tc{text-align:center}

  /* Modal base */
  .modal{position:fixed;inset:0;display:none;opacity:0;visibility:hidden;z-index:9999}
  .modal.open, .modal[open]{display:block !important; opacity:1 !important; visibility:visible !important; z-index:100000 !important}
  .modal-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.45)}
  .modal-card{
    position:relative;margin:5vh auto 0;max-width:720px;width:96vw;background:#fff;border:1px solid #e5e7eb;border-radius:12px;
    display:flex;flex-direction:column;max-height:92vh;box-shadow:0 20px 60px rgba(2,8,23,.25);z-index:1
  }
  .modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #e5e7eb}
  .modal-body{padding:12px;overflow:auto;flex:1 1 auto}
  .modal-actions{position:sticky;bottom:0;padding:12px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;background:#fff}

  /* Larger Assign Rooms modal */
  #as-modal .modal-card{ max-width:980px; width:98vw; min-height:420px; }
  #as-rooms{ min-height:300px; font-size:14px; }

  /* Row action buttons */
  .row-actions{display:flex;gap:6px;flex-wrap:wrap}
  `;
    host.appendChild(style);

    /* ---------------- refs ---------------- */
    const qs = s => host.querySelector(s);
    const q = qs("#q"), rows = qs("#rows");
    const btnAdd = qs("#btn-add"), btnAssign = qs("#btn-assign");

    // add/edit modal
    const rmModal = qs("#rm-modal"), rmClose = qs("#rm-close"), rmBackdrop = qs("#rm-backdrop");
    const rmTitle = qs("#rm-title"), rmNo = qs("#rm-no"), rmRate = qs("#rm-rate"), rmSave = qs("#rm-save");
    let editingRoomNo = null;

    // assign modal
    const asModal = qs("#as-modal"), asClose = qs("#as-close"), asBackdrop = qs("#as-backdrop");
    const asGuest = qs("#as-guest"), asRooms = qs("#as-rooms"), asSave = qs("#as-save");

    /* ---------------- events ---------------- */
    q.addEventListener("input", renderTable);
    btnAdd.addEventListener("click", () => openRoomModal());
    btnAssign.addEventListener("click", openAssignModal);

    rmClose.addEventListener("click", closeRoomModal);
    rmBackdrop.addEventListener("click", closeRoomModal);
    rmSave.addEventListener("click", onSaveRoom);

    asClose.addEventListener("click", closeAssignModal);
    asBackdrop.addEventListener("click", closeAssignModal);
    asSave.addEventListener("click", onAssignRooms);

    const unsub = store.subscribe?.(renderTable);
    host.addEventListener("DOMNodeRemoved", () => unsub?.());

    renderTable();
    return host;

    /* ---------------- render ---------------- */
    function renderTable() {
        const D = ensure(getState());
        const search = (q.value || "").trim().toLowerCase();

        const list = (D.rooms || []).slice().sort((a, b) =>
            roomNoOf(a).localeCompare(roomNoOf(b), undefined, { numeric: true })
        ).filter(r => {
            if (!search) return true;
            const guest = (D.guests || []).find(g => String(g.id) === String(r.guestId));
            const blob = `${roomNoOf(r)} ${guest?.name || ""}`.toLowerCase();
            return blob.includes(search);
        });

        rows.innerHTML = "";
        if (!list.length) {
            rows.innerHTML = `<tr><td colspan="5" class="tc muted">No rooms</td></tr>`;
            return;
        }

        const frag = document.createDocumentFragment();
        for (const r of list) {
            const no = roomNoOf(r), rate = roomRateOf(r), occ = roomOcc(r);
            const g = (D.guests || []).find(x => String(x.id) === String(r.guestId));
            const badge = occ ? `<span class="badge danger">Occupied</span>` : `<span class="badge ok">Vacant</span>`;
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${esc(no)}</td>
        <td class="r">${rate ? "Rs " + Number(rate).toLocaleString() : "—"}</td>
        <td>${badge}</td>
        <td>${occ ? esc(g?.name || "(unknown)") : "<span class='muted'>—</span>"}</td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="btn xs" data-edit="${esc(no)}">Edit</button>
            ${occ
                    ? `<button class="btn xs" data-free="${esc(no)}">Free</button>`
                    : `<button class="btn xs" data-assign-one="${esc(no)}">Assign</button>`
                }
            <button class="btn xs" data-del="${esc(no)}">Delete</button>
          </div>
        </td>
      `;
            frag.appendChild(tr);
        }
        rows.appendChild(frag);

        // bind row actions
        rows.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openRoomModal(b.dataset.edit)));
        rows.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => onDeleteRoom(b.dataset.del)));
        rows.querySelectorAll("[data-free]").forEach(b => b.addEventListener("click", () => onFreeRoom(b.dataset.free)));
        rows.querySelectorAll("[data-assign-one]").forEach(b => b.addEventListener("click", () => openAssignModal(b.dataset.assignOne)));
    }

    /* ---------------- add/edit room ---------------- */
    function openRoomModal(roomNo = "") {
        editingRoomNo = roomNo || null;
        const D = ensure(getState());
        if (roomNo) {
            const r = (D.rooms || []).find(x => roomNoOf(x) === String(roomNo));
            rmTitle.textContent = `Edit Room ${roomNo}`;
            rmNo.value = roomNoOf(r) || "";
            rmRate.value = roomRateOf(r) || "";
        } else {
            rmTitle.textContent = "Add Room";
            rmNo.value = ""; rmRate.value = "";
        }
        showModal(rmModal);
    }
    function onSaveRoom() {
        const no = (rmNo.value || "").trim();
        const rate = Number(rmRate.value || 0);
        if (!no) { alert("Room number is required"); return; }

        save(prev => {
            const n = ensure(prev);
            n.rooms = upsertRoom(n.rooms || [], editingRoomNo, no, rate);
            // if room number changed & it was occupied, re-link guestId stays with same room
            return n;
        });
        closeRoomModal();
        renderTable();
    }
    function onDeleteRoom(roomNo) {
        if (!confirm(`Delete room ${roomNo}?`)) return;
        save(prev => {
            let n = ensure(prev);
            const r = (n.rooms || []).find(x => roomNoOf(x) === String(roomNo));
            if (r?.guestId) n = detachRoomFromGuest(n, r.guestId, roomNo);
            n.rooms = (n.rooms || []).filter(x => roomNoOf(x) !== String(roomNo));
            return n;
        });
        renderTable();
    }
    function onFreeRoom(roomNo) {
        save(prev => {
            let n = ensure(prev);
            const r = (n.rooms || []).find(x => roomNoOf(x) === String(roomNo));
            if (!r?.guestId) return n;
            n = detachRoomFromGuest(n, r.guestId, roomNo);
            return n;
        });
        renderTable();
    }
    function closeRoomModal() { hideModal(rmModal); editingRoomNo = null; }

    /* ---------------- assign rooms ---------------- */
    function openAssignModal(preselectRoomNo = "") {
        populateAssignLists(preselectRoomNo);
        showModal(asModal);
    }
    function populateAssignLists(preselectRoomNo = "") {
        const D = ensure(getState());

        // Guests: status checked-in or arrival, not checked-out
        const guests = (D.guests || []).filter(g => {
            const st = String(g.status || "checked-in").toLowerCase();
            return (st === "checked-in" || st === "arrival") && !g.checkedOut;
        }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        asGuest.innerHTML =
            `<option value="">— Select Guest —</option>` +
            guests.map(g => `<option value="${esc(g.id)}">${esc(g.name || "Guest")} ${g.roomNo ? "• " + esc(g.roomNo) : ""}</option>`).join("");

        // whenever guest changes, rebuild rooms list so "already assigned to this guest" become enabled
        asGuest.onchange = () => buildRoomsForSelectedGuest(preselectRoomNo);
        buildRoomsForSelectedGuest(preselectRoomNo);
    }
    function buildRoomsForSelectedGuest(preselectRoomNo = "") {
        const D = ensure(getState());
        const gid = asGuest.value || "";
        const guest = (D.guests || []).find(g => String(g.id) === String(gid));
        const rooms = (D.rooms || []).slice().sort((a, b) => roomNoOf(a).localeCompare(roomNoOf(b), undefined, { numeric: true }));

        // enable rooms that are vacant OR already assigned to this selected guest
        const html = rooms.map(r => {
            const no = roomNoOf(r);
            const assignedToGuest = guest && String(r.guestId) === String(guest.id);
            const canPick = !roomOcc(r) || assignedToGuest;
            const label = `${no} — ${assignedToGuest ? "Assigned to this guest" : (roomOcc(r) ? "Occupied" : "Vacant")}`;
            return `<option value="${esc(no)}" ${canPick ? "" : "disabled"}>${esc(label)}</option>`;
        }).join("");

        asRooms.innerHTML = html;

        // preselect a room if we came from "Assign" button on that row
        if (preselectRoomNo) {
            const opt = Array.from(asRooms.options).find(o => String(o.value) === String(preselectRoomNo) && !o.disabled);
            if (opt) opt.selected = true;
        }
    }
    function onAssignRooms() {
        const gid = asGuest.value || "";
        const picks = Array.from(asRooms.selectedOptions).filter(o => !o.disabled).map(o => o.value);
        if (!gid) { alert("Select a guest"); return; }
        if (!picks.length) { alert("Select one or more rooms"); return; }

        save(prev => {
            let n = ensure(prev);
            n = attachRoomsToGuest(n, gid, picks);
            n = updateGuestAggregate(n, gid);
            return n;
        });

        closeAssignModal();
        renderTable();
    }
    function closeAssignModal() { hideModal(asModal); }

    /* ---------------- modal helpers (triple-safe show) ---------------- */
    function showModal(el) {
        if (!el) return;
        el.classList.add("open");
        el.setAttribute("open", "");            // attribute present => [open] matches
        el.style.display = "block";             // inline fallback
        // prevent background scroll (optional)
        document.documentElement.style.overflow = "hidden";
    }
    function hideModal(el) {
        if (!el) return;
        el.classList.remove("open");
        el.removeAttribute("open");
        el.style.display = "none";
        document.documentElement.style.overflow = ""; // restore scroll
    }
}
