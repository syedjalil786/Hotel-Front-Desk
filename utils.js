// utils.js � cache-busting HTML loader + safe CSS injector (keeps YOUR HTML)
"use strict";

/**
 * Load an HTML partial fresh (no cache) and return a DocumentFragment.
 * If the fragment lacks any [data-view], we tag the first element with
 * data-view="<tabName>" based on the filename (e.g. checkin.html -> checkin).
 * This lets your existing code still do frag.querySelector("[data-view='checkin']").
 */
export async function loadHTML(path) {
    const url = addBuster(path);
    const res = await fetch(url, { cache: "no-store" });
    const html = await res.text();

    const t = document.createElement("template");
    t.innerHTML = html.trim();
    const frag = t.content.cloneNode(true);

    // Auto-tag first element with data-view if none present
    try {
        if (!frag.querySelector || !frag.querySelector("[data-view]")) {
            const first = firstElement(frag);
            const name = inferName(path);
            if (first && name) first.setAttribute("data-view", name);
        }
    } catch (_) { }

    return frag;
}

export function useTabCSS(name) {
    const id = "css-" + name;
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement("link");
        el.id = id;
        el.rel = "stylesheet";
        el.href = addBuster(`tabs/${name}.css`);
        document.head.appendChild(el);
    } else {
        // force refresh if CSS was cached
        el.href = addBuster(el.href.split("?")[0]);
    }
}

/* helpers */
function addBuster(p) {
    const base = String(p);
    return base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();
}
function inferName(path) {
    const noQ = String(path).split("?")[0];
    const file = noQ.substring(noQ.lastIndexOf("/") + 1);
    return file.toLowerCase().endsWith(".html") ? file.slice(0, -5) : file;
}
function firstElement(fragment) {
    const nodes = fragment.childNodes || [];
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 1) return nodes[i];
    }
    return null;
}
