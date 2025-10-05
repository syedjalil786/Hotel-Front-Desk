// tabs/settings.js
import { loadHTML, useTabCSS } from "../utils.js";
import { store } from "../state.js";

export default async function view() {
    useTabCSS("settings");

    // Load HTML fragment
    const frag = await loadHTML("tabs/settings.html");

    // Host for this tab (kept off-DOM until returned)
    const host = document.createElement("div");
    const root = frag.querySelector("[data-view='settings']");
    if (root) host.appendChild(root);

    // Scoped query helpers (IMPORTANT: scope to host, not document)
    const $ = (id) => host.querySelector("#" + id);
    const $$ = (sel) => host.querySelector(sel);

    // Action refs
    const saveTop = $("set-save-top");
    const saveBot = $("set-save-bot");
    const exportBtn = $("set-export-settings");
    const importInp = $("set-import-settings");
    const resetBtn = $("set-reset");
    const msgEl = $("set-msg");

    // Uploads / preview refs
    const logoFile = $("logoFile");
    const logoRemove = $("logoRemove");
    const logoPreview = $("logoPreview");
    const signFile = $("signFile");
    const signRemove = $("signRemove");
    const signPreview = $("signPreview");

    // PDF preview refs (scoped)
    const prevLogo = $("pdf-prev-logo");
    const prevHotel = $("pdf-prev-hotel");
    const prevSub = $("pdf-prev-sub");
    const prevDoc = $("pdf-prev-doc");
    const prevTerms = $("pdf-prev-terms");
    const prevSign = $("pdf-prev-sign");
    const prevWM = $("pdf-prev-wm");
    const prevShell = $$(".pdf-preview");

    // Load settings into UI
    const defaults = getDefaults();
    const cur = store.get() || {};
    const loaded = deepMerge(defaults, cur.settings || {});
    fillUI(loaded, $, logoPreview, signPreview, host);
    updatePreview();

    // Wire events (all scoped to host)
    if (saveTop) saveTop.addEventListener("click", onSave);
    if (saveBot) saveBot.addEventListener("click", onSave);
    if (exportBtn) exportBtn.addEventListener("click", onExport);
    if (importInp) importInp.addEventListener("change", onImport);
    if (resetBtn) resetBtn.addEventListener("click", onReset);

    // Live preview for any input inside this tab
    host.addEventListener("input", updatePreview);

    // Upload handlers
    if (logoFile) logoFile.addEventListener("change", (e) => loadImageTo(e, "logo"));
    if (logoRemove) logoRemove.addEventListener("click", () => removeImage("logo"));
    if (signFile) signFile.addEventListener("change", (e) => loadImageTo(e, "signature"));
    if (signRemove) signRemove.addEventListener("click", () => removeImage("signature"));

    return host;

    /* ===== actions ===== */
    function onSave() {
        const v = readUI($, logoPreview, signPreview, host);
        const d = store.get() || {};
        d.settings = v;
        store.set(d); // emits store:change (if using provided state.js)
        say("Settings saved ✔️");
    }

    function onExport() {
        const v = readUI($, logoPreview, signPreview, host);
        download(JSON.stringify(v, null, 2), "hotel-settings.json", "application/json");
    }

    function onImport(evt) {
        const f = evt?.target?.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const obj = JSON.parse(String(reader.result || "{}"));
                const merged = deepMerge(getDefaults(), obj);
                fillUI(merged, $, logoPreview, signPreview, host);
                updatePreview();
                say("Imported settings (not saved yet)");
            } catch (e) { say("Invalid file", true); }
            evt.target.value = "";
        };
        reader.readAsText(f);
    }

    function onReset() {
        if (!confirm("Reset all settings to defaults?")) return;
        const def = getDefaults();
        fillUI(def, $, logoPreview, signPreview, host);
        updatePreview();
        const d = store.get() || {};
        d.settings = def;
        store.set(d);
        say("Settings reset ✔️");
    }

    /* ===== preview & uploads ===== */
    function updatePreview() {
        const s = readUI($, logoPreview, signPreview, host);

        if (prevHotel) prevHotel.textContent = s.hotelName || "Hotel Name";
        if (prevSub) prevSub.textContent = join([s.address, s.phone, s.email], " • ");
        if (prevDoc) prevDoc.textContent = s.invoice.title || "TAX INVOICE";
        if (prevTerms) prevTerms.textContent = s.invoice.terms || "";

        const showLogo = s.pdf.showLogo === "yes";
        if (prevLogo) {
            prevLogo.style.display = (showLogo && s.logo) ? "block" : "none";
            prevLogo.src = (showLogo && s.logo) ? s.logo : "";
        }
        if (prevSign) {
            prevSign.src = s.signature || "";
            prevSign.style.display = s.signature ? "block" : "none";
        }

        if (prevShell) {
            prevShell.style.setProperty("--head", s.pdf.headerColor || "#0ea5e9");
            prevShell.style.setProperty("--accent", s.pdf.accentColor || "#2563eb");
            prevShell.style.setProperty("--fs", (Number(s.pdf.fontSize || 12)) + "px");
            prevShell.style.setProperty("--mt", Math.max(8, Number(s.pdf.marginTop || 16)) + "px");
            prevShell.style.setProperty("--mlr", Math.max(8, Number(s.pdf.marginLR || 16)) + "px");
        }

        if (prevWM) {
            const on = s.pdf.watermarkOn === "yes";
            prevWM.textContent = s.pdf.watermarkText || "PAID";
            prevWM.style.display = on ? "flex" : "none";
        }
    }

    function loadImageTo(evt, which) {
        const f = evt?.target?.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
            const data = String(reader.result || "");
            host.dataset[which] = data; // keep unsaved value until Save
            if (which === "logo" && logoPreview) { logoPreview.src = data; logoPreview.style.display = "block"; }
            if (which === "signature" && signPreview) { signPreview.src = data; signPreview.style.display = "block"; }
            updatePreview();
            say((which === "logo" ? "Logo" : "Signature") + " loaded");
            evt.target.value = "";
        };
        reader.readAsDataURL(f);
    }

    function removeImage(which) {
        host.dataset[which] = "";
        if (which === "logo" && logoPreview) { logoPreview.src = ""; logoPreview.style.display = "none"; }
        if (which === "signature" && signPreview) { signPreview.src = ""; signPreview.style.display = "none"; }
        updatePreview();
    }

    /* ===== tiny helpers (scoped-safe) ===== */
    function say(msg, error) {
        if (!msgEl) return;
        msgEl.textContent = msg || "";
        msgEl.style.color = error ? "#dc2626" : "#6b7280";
        setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 2500);
    }

    function join(arr, sep) {
        const a = []; for (let i = 0; i < arr.length; i++) { const v = String(arr[i] || "").trim(); if (v) a.push(v); }
        return a.join(sep);
    }
}

/* ===== pure functions (no DOM globals) ===== */

function getDefaults() {
    return {
        hotelName: "Your Hotel",
        phone: "",
        email: "",
        website: "",
        address: "",
        currency: "PKR",
        currencyLabel: "Rs",
        locale: "en-PK",
        dateFormat: "YYYY-MM-DD",
        timeFormat: "HH:mm",
        taxRate: 0,
        svcRate: 0,
        discountMode: "percent",
        sequence: { invoicePrefix: "INV-", invoiceNext: 1, receiptPrefix: "RCT-", receiptNext: 1 },
        defaults: { checkoutTime: "12:00", roomRent: 0, persons: 1 },
        invoice: { title: "TAX INVOICE", terms: "Payment within 7 days. Thank you!", footerNote: "" },
        pdf: {
            showLogo: "yes",
            headerColor: "#0ea5e9",
            accentColor: "#2563eb",
            fontSize: 12,
            pageSize: "A4",
            marginTop: 16,
            marginLR: 16,
            showTax: "yes",
            watermarkText: "PAID",
            watermarkOn: "no"
        },
        receipts: { width: 80, showQR: "no", qrText: "" },
        logo: "",
        signature: ""
    };
}

function readUI($, logoPreview, signPreview, host) {
    const logo = (host.dataset.logo != null) ? host.dataset.logo : (logoPreview ? logoPreview.src : "");
    const signature = (host.dataset.signature != null) ? host.dataset.signature : (signPreview ? signPreview.src : "");
    return {
        hotelName: v($("hotelName")),
        phone: v($("phone")),
        email: v($("email")),
        website: v($("website")),
        address: v($("address")),
        currency: v($("currency")) || "PKR",
        currencyLabel: v($("currencyLabel")) || "Rs",
        locale: v($("locale")) || "en-PK",
        dateFormat: v($("dateFormat")) || "YYYY-MM-DD",
        timeFormat: v($("timeFormat")) || "HH:mm",
        taxRate: n($("taxRate")),
        svcRate: n($("svcRate")),
        discountMode: v($("discountMode")) || "percent",
        sequence: {
            invoicePrefix: v($("invPrefix")) || "INV-",
            invoiceNext: i($("invNext"), 1),
            receiptPrefix: v($("recPrefix")) || "RCT-",
            receiptNext: i($("recNext"), 1)
        },
        defaults: {
            checkoutTime: v($("checkoutTime")) || "12:00",
            roomRent: n($("defRoomRent")),
            persons: i($("defPersons"), 1)
        },
        invoice: {
            title: v($("invoiceTitle")) || "TAX INVOICE",
            terms: v($("invoiceTerms")) || "",
            footerNote: v($("invoiceFooter")) || ""
        },
        pdf: {
            showLogo: v($("pdfShowLogo")) || "yes",
            headerColor: v($("pdfHeaderColor")) || "#0ea5e9",
            accentColor: v($("pdfAccentColor")) || "#2563eb",
            fontSize: i($("pdfFontSize"), 12),
            pageSize: v($("pdfPageSize")) || "A4",
            marginTop: i($("pdfMarginTop"), 16),
            marginLR: i($("pdfMarginLR"), 16),
            showTax: v($("pdfShowTax")) || "yes",
            watermarkText: v($("pdfWatermarkText")) || "PAID",
            watermarkOn: v($("pdfWatermarkOn")) || "no"
        },
        receipts: {
            width: i($("rcWidth"), 80),
            showQR: v($("rcShowQR")) || "no",
            qrText: v($("rcQRText")) || ""
        },
        logo: logo || "",
        signature: signature || ""
    };
}

function fillUI(s, $, logoPreview, signPreview, host) {
    set($("hotelName"), s.hotelName);
    set($("phone"), s.phone);
    set($("email"), s.email);
    set($("website"), s.website);
    set($("address"), s.address);

    set($("currency"), s.currency);
    set($("currencyLabel"), s.currencyLabel);
    set($("locale"), s.locale);
    set($("dateFormat"), s.dateFormat);
    set($("timeFormat"), s.timeFormat);

    set($("taxRate"), s.taxRate);
    set($("svcRate"), s.svcRate);
    set($("discountMode"), s.discountMode);

    set($("invPrefix"), s.sequence?.invoicePrefix);
    set($("invNext"), s.sequence?.invoiceNext);
    set($("recPrefix"), s.sequence?.receiptPrefix);
    set($("recNext"), s.sequence?.receiptNext);

    set($("checkoutTime"), s.defaults?.checkoutTime);
    set($("defRoomRent"), s.defaults?.roomRent);
    set($("defPersons"), s.defaults?.persons);

    set($("invoiceTitle"), s.invoice?.title);
    set($("invoiceTerms"), s.invoice?.terms);
    set($("invoiceFooter"), s.invoice?.footerNote);

    set($("pdfShowLogo"), s.pdf?.showLogo);
    set($("pdfHeaderColor"), s.pdf?.headerColor);
    set($("pdfAccentColor"), s.pdf?.accentColor);
    set($("pdfFontSize"), s.pdf?.fontSize);
    set($("pdfPageSize"), s.pdf?.pageSize);
    set($("pdfMarginTop"), s.pdf?.marginTop);
    set($("pdfMarginLR"), s.pdf?.marginLR);
    set($("pdfShowTax"), s.pdf?.showTax);
    set($("pdfWatermarkText"), s.pdf?.watermarkText);
    set($("pdfWatermarkOn"), s.pdf?.watermarkOn);

    set($("rcWidth"), s.receipts?.width);
    set($("rcShowQR"), s.receipts?.showQR);
    set($("rcQRText"), s.receipts?.qrText);

    if (logoPreview) { logoPreview.src = s.logo || ""; logoPreview.style.display = s.logo ? "block" : "none"; }
    if (signPreview) { signPreview.src = s.signature || ""; signPreview.style.display = s.signature ? "block" : "none"; }
    host.dataset.logo = s.logo || "";
    host.dataset.signature = s.signature || "";
}

function v(el) { return el ? String(el.value || "").trim() : ""; }
function set(el, val) { if (el) el.value = (val == null ? "" : val); }
function n(el) { return el ? Number(el.value || 0) : 0; }
function i(el, def) { const n = el ? parseInt(el.value || "", 10) : NaN; return isNaN(n) ? (def || 0) : n; }

function download(text, name, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function deepMerge(base, extra) {
    const out = Array.isArray(base) ? [] : {};
    for (const k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) { const v = base[k]; out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? deepMerge(v, {}) : v; } }
    if (extra && typeof extra === "object") {
        for (const k in extra) {
            if (!Object.prototype.hasOwnProperty.call(extra, k)) continue;
            const v = extra[k];
            out[k] = (v && typeof v === "object" && !Array.isArray(v)) ? deepMerge(out[k] || {}, v) : v;
        }
    }
    return out;
}


// === App Lock (auto-added) ===
import { setAppPin, disableAppLock, lockNow } from "../app-lock.js";

(function addAppLockPanel(){
  try{
    const host = document.querySelector('[data-view="settings"]') || document.body;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="panel-head"><h3>App Lock (PIN)</h3><span class="muted">One-time unlock per device</span></div>
      <div class="grid-3">
        <div class="fi">
          <label>Enable App Lock</label>
          <div class="inline">
            <input type="checkbox" id="al-enable" />
            <span class="muted">Require PIN on first open</span>
          </div>
        </div>
        <div class="fi">
          <label>Set / Change PIN</label>
          <div class="inline">
            <input id="al-pin" class="input" placeholder="4–8 digit PIN" inputmode="numeric" maxlength="8" />
            <button class="btn" id="al-set">Save PIN</button>
          </div>
        </div>
        <div class="fi">
          <label>Actions</label>
          <div class="inline">
            <button class="btn" id="al-locknow">Lock Now</button>
            <button class="btn warn" id="al-disable">Disable</button>
          </div>
        </div>
      </div>`;
    host.appendChild(panel);

    const S = (store.get?.() || {}).settings || {};
    const enableEl = panel.querySelector("#al-enable");
    const pinEl = panel.querySelector("#al-pin");
    enableEl.checked = !!S.appLockEnabled;

    enableEl.addEventListener("change", () => {
      store.update?.(prev => { const n = { ...(prev||{}) }; n.settings ||= {}; n.settings.appLockEnabled = enableEl.checked; return n; });
      alert(enableEl.checked ? "App lock enabled." : "App lock disabled.");
    });

    panel.querySelector("#al-set").addEventListener("click", async () => {
      const pin = (pinEl.value || "").trim();
      try { await setAppPin(pin); alert("PIN saved. This device will require unlock next time."); pinEl.value=""; }
      catch(e){ alert(e?.message || "Failed to set PIN"); }
    });
    panel.querySelector("#al-disable").addEventListener("click", () => { if(confirm("Disable app lock?")) { disableAppLock(); enableEl.checked=false; } });
    panel.querySelector("#al-locknow").addEventListener("click", () => { lockNow(); });
  }catch(e){ /* ignore */ }
})();
