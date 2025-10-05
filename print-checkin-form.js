/* tabs/print-checkin-form.js
 * Renders & prints your A4 Check-In form (unchanged HTML/CSS)
 * Pulls values from the existing Check-In UI or falls back to store state.
 * Uses Mustache-like {{var}}, {{var|Default}}, {{#cond}}…{{/cond}}.
 * Currency is shown with no decimals (Rs 5,000).
 */

; (function () {
    // ---------- helpers ----------
    const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]);
    const d8 = iso => (iso || "").slice(0, 10);
    const num0 = v => Math.round(Number(v || 0));
    const moneyNoDec = n => `Rs ${String(num0(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    const todayISO = () => new Date().toISOString().slice(0, 10);

    function getStore() {
        try { return (window.store && typeof store.get === "function") ? store.get() : (window.__APP_STATE__ || {}); }
        catch { return window.__APP_STATE__ || {}; }
    }

    // attempts multiple selectors to match your current Check-In UI
    function pick(...selectors) {
        for (const q of selectors) {
            const el = q && document.querySelector(q);
            if (!el) continue;
            if (el.type === "file") {
                return el.files?.[0]?.name || String(el.value || "").split("\\").pop() || "";
            }
            if (/INPUT|TEXTAREA|SELECT/i.test(el.tagName)) return el.value?.trim?.() ?? el.value ?? "";
            return (el.textContent || el.innerText || "").trim();
        }
        return "";
    }

    // ---------- data extraction ----------
    function readCheckInValues() {
        const live = {
            name: pick("#name,[name='name'],[data-field='name']"),
            fatherName: pick("#fatherName,[name='fatherName'],[data-field='fatherName']"),
            cnic: pick("#cnic,[name='cnic'],[name='passport'],[data-field='cnic'],[data-field='passport']"),
            mobile: pick("#mobile,[name='mobile'],[name='phone'],[data-field='mobile']"),
            persons: pick("#persons,[name='persons'],[data-field='persons']"),
            checkInDate: pick("#checkInDate,[name='checkInDate'],[data-field='checkInDate']"),
            checkInTime: pick("#checkInTime,[name='checkInTime'],[data-field='checkInTime']"),
            address: pick("#address,[name='address'],[data-field='address']"),
            companyName: pick("#companyName,[name='companyName'],[data-field='companyName']"),
            checkOutDate: pick("#checkOutDate,[name='checkOutDate'],[data-field='checkOutDate']"),
            checkOutTime: pick("#checkOutTime,[name='checkOutTime'],[data-field='checkOutTime']"),
            roomNo: pick("#roomNo,[name='roomNo'],[data-field='roomNo']"),
            roomRent: pick("#roomRent,[name='roomRent'],[data-field='roomRent']"),
            status: pick("#status,[name='status'],[data-field='status']"),
            attachment: pick("#attachment,[name='attachment'],input[type='file'][data-field='attachment']"),
        };

        const D = getStore();
        const S = D.settings || {};
        const g = (D.guests || []).find(x => !x.checkedOut && (x.status || "checked-in") !== "checked-out") || {};
        const roomRentNum = Number(live.roomRent || g.roomRent || 0);

        return {
            // check-in fields
            name: live.name || g.name || "",
            fatherName: live.fatherName || g.fatherName || "",
            cnic: live.cnic || g.cnic || g.passport || "",
            mobile: live.mobile || g.mobile || "",
            persons: live.persons || g.persons || "",
            checkInDate: d8(live.checkInDate || g.checkInDate || todayISO()),
            checkInTime: live.checkInTime || g.checkInTime || "",
            address: live.address || g.address || "",
            companyName: live.companyName || g.companyName || "",
            checkOutDate: d8(live.checkOutDate || g.checkOutDate || ""),
            checkOutTime: live.checkOutTime || g.checkOutTime || "",
            roomNo: live.roomNo || g.roomNo || "",
            roomRentMoney: moneyNoDec(roomRentNum),
            status: (live.status || g.status || "checked-in"),
            attachmentName: live.attachment || g.attachmentName || "",

            // header/meta
            hotelName: S.hotelName || "Hotel Front Desk",
            addressHdr: S.address || "",
            phone: S.phone || "",
            logo: S.logo || "",
            today: todayISO(),
        };
    }

    // ---------- tiny template engine ({{var}}, {{var|Default}}, {{#cond}}…{{/cond}}) ----------
    function render(tpl, data) {
        tpl = tpl.replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, key, inner) => (data[key] ? inner : ""));
        tpl = tpl.replace(/{{\s*([\w]+)\s*\|\s*([^}]+)\s*}}/g, (_, key, def) => esc((data[key] ?? "") === "" ? def : data[key]));
        tpl = tpl.replace(/{{\s*([\w]+)\s*}}/g, (_, key) => esc(data[key] ?? ""));
        return tpl;
    }

    // ---------- A4 HTML/CSS (exactly your layout) ----------
    const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Check-In Form</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root{
      --ink:#111; --muted:#6b7280; --border:#d1d5db; --accent:#111; --pad:12mm;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
    }
    @page { size:A4; margin:0; }
    html,body{ height:100%; }
    body{ margin:0; background:#f5f7fb; color:var(--ink); font-family:var(--font); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sheet{ width:210mm; min-height:297mm; background:#fff; margin:10mm auto; padding:var(--pad); box-shadow:0 2px 20px rgba(0,0,0,.07); display:flex; flex-direction:column; gap:10mm; }
    @media print { body{background:#fff;} .sheet{margin:0; box-shadow:none; page-break-after:always;} }

    .head{ display:flex; align-items:center; gap:14px; border-bottom:2px solid var(--ink); padding-bottom:8px; }
    .logo{ height:48px; width:auto; object-fit:contain; }
    .head h1{ font-size:18px; line-height:1.2; margin:0 0 4px 0; font-weight:700; letter-spacing:.2px; }
    .muted{ color:var(--muted); font-size:12px; }

    .meta{ display:flex; justify-content:flex-end; font-size:12px; color:#1f2937; }

    .section-title{ margin:0; font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:700; color:var(--accent); border-left:3px solid var(--accent); padding-left:8px; }

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
    .signs .line{ height:36px; border-bottom:1.5px solid var(--ink); display:flex; align-items:flex-end; justify-content:center; font-size:12px; color:var(--muted); padding-bottom:6px; }
  </style>
</head>
<body>
  <section class="sheet">
    <div class="head">
      {{#logo}}<img class="logo" src="{{logo}}">{{/logo}}
      <div>
        <h1>{{hotelName|Hotel Front Desk}} — Check-In Form</h1>
        <div class="muted">{{addressHdr}} {{#phone}}• {{phone}}{{/phone}}</div>
      </div>
    </div>

    <div class="meta"><strong>Date:</strong>&nbsp;{{today}}</div>

    <h2 class="section-title">Particular</h2>
    <table class="details">
      <tr>
        <th>Guest Name</th><td>{{name}}</td>
        <th>Father's Name</th><td>{{fatherName}}</td>
      </tr>
      <tr>
        <th>CNIC / Passport No.</th><td>{{cnic}}</td>
        <th>Mobile No.</th><td>{{mobile}}</td>
      </tr>
      <tr>
        <th>Persons</th><td>{{persons}}</td>
        <th>Check-IN Date</th><td>{{checkInDate}}</td>
      </tr>
      <tr>
        <th>Check-IN Time</th><td>{{checkInTime}}</td>
        <th>Address</th><td>{{address}}</td>
      </tr>
      <tr>
        <th>Company Name</th><td>{{companyName}}</td>
        <th>Check-OUT Date</th><td>{{checkOutDate}}</td>
      </tr>
      <tr>
        <th>Check-OUT Time</th><td>{{checkOutTime}}</td>
        <th>Room No.</th><td>{{roomNo}}</td>
      </tr>
      <tr>
        <th>Room Rent</th><td>{{roomRentMoney}}</td>
        <th>Status</th><td>{{status}}</td>
      </tr>
      <tr>
        <th>Attachment</th>
        <td colspan="3">{{#attachmentName}}{{attachmentName}}{{/attachmentName}}</td>
      </tr>
    </table>

    <div class="policy">
      <h3>{{hotelName|Stayinn Rooms & Apartments}} House Rules</h3>
      <h4>Check-in/Check-out Policy</h4>
      <ul>
        <li>Check-in time: 12:00 PM (noon) onwards</li>
        <li>Check-out time: 11:00 AM – 12:00 PM (late check-out may incur a half-night charge)</li>
      </ul>
      <h4>Payment Policy</h4>
      <ul>
        <li>Advance payment is required at the time of check-in</li>
        <li>Payment receipt will be provided upon request</li>
      </ul>
      <h4>Guest Policy</h4>
      <ul>
        <li>Unmarried couples are not allowed to stay together in the same room</li>
        <li>Guests are responsible for their visitors and must ensure they comply with house rules</li>
      </ul>
      <h4>Prohibited Items</h4>
      <ul>
        <li>Alcohol and alcoholic beverages</li>
        <li>Fire items (e.g., candles, lighters, etc.)</li>
        <li>Weapons of any kind</li>
      </ul>
      <h4>Room Policy</h4>
      <ul>
        <li>Guests are responsible for any missing items from their room</li>
        <li>Damages to the room or its contents will incur a charge, determined by management</li>
      </ul>
      <h4>Additional Rules</h4>
      <ul>
        <li>Smoking is not allowed inside the rooms (designated smoking areas are available)</li>
        <li>Loud noise and disturbances are not allowed after 10:00 PM</li>
        <li>Guests are responsible for keeping their room keys safe and secure</li>
        <li>Management reserves the right to evict guests who fail to comply with house rules</li>
        <li>Please report any issues or concerns to management promptly</li>
      </ul>

      <p class="ack">
        By checking in, guests acknowledge that they have read, understood, and agreed to comply with these house rules.
        Management is not responsible for loss or damage to personal belongings.
      </p>
    </div>

    <div class="signs">
      <div class="line">Guest Signature</div>
      <div class="line">Manager / Receptionist Signature</div>
    </div>
  </section>
</body>
</html>`;

    // ---------- print ----------
    function printCheckInForm() {
        const data = readCheckInValues();
        const html = render(TEMPLATE, data);
        const w = window.open("", "_blank");
        if (!w) { alert("Popup blocked. Please allow pop-ups."); return; }
        w.document.write(html + `<script>window.print()</script>`);
        w.document.close();
    }

    // ---------- public init ----------
    function initBuiltInCheckInForm() {
        // Wire up on the standard button if present
        const btn = document.querySelector("#btn-print-form, [data-action='print-form']");
        if (btn) btn.addEventListener("click", (e) => { e.preventDefault?.(); printCheckInForm(); });

        // Safe fallback: also listen to a custom event
        window.addEventListener("print-checkin-form", printCheckInForm);
    }

    // expose
    window.initBuiltInCheckInForm = initBuiltInCheckInForm;
})();
