/* tabs/checkin-print-hook.js
 * Auto-add a "Print Form" button to the Check-In screen and initialize the printer.
 * Safe to include on any page; it only activates on #/check-in.
 */

(function () {
    function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

    function ensurePrintButton() {
        // try to find a footer/action bar near check-in form
        let bar = document.querySelector("#checkin-actions, .actions, .actions-bar, .form-actions");
        if (!bar) {
            // create a light action bar at the end of the form
            const lastPanel = document.querySelector("[data-view='check-in'] .panel, [data-view='check-in'] form") || document.querySelector("[data-view='check-in']");
            bar = document.createElement("div");
            bar.className = "actions-bar";
            bar.style.display = "flex";
            bar.style.gap = "8px";
            bar.style.marginTop = "10px";
            lastPanel && lastPanel.appendChild(bar);
        }

        // add button only if not present
        if (!document.querySelector("#btn-print-form, [data-action='print-form']")) {
            const b = document.createElement("button");
            b.id = "btn-print-form";
            b.type = "button";
            b.textContent = "Print Form";
            b.className = "btn";
            bar.appendChild(b);
        }
    }

    function onHash() {
        const route = (location.hash || "").replace(/^#\/?/, "");
        if (route.startsWith("check-in")) {
            ensurePrintButton();
            if (typeof window.initBuiltInCheckInForm === "function") {
                window.initBuiltInCheckInForm();
            }
        }
    }

    ready(onHash);
    window.addEventListener("hashchange", onHash);
})();
