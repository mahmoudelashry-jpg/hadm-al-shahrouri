import * as pdfjsLib from "./pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const root = document.getElementById("pages");
const statusEl = document.getElementById("status");
const pgIn = document.getElementById("pg");
const pgTotal = document.getElementById("pgTotal");
const resumeBtn = document.getElementById("resume");
const SRC = root.dataset.pdf;
const KEY = "lastpage:" + location.pathname;

const ar = n => Number(n).toLocaleString("ar-EG", { useGrouping: false });
const toNum = s => parseInt(String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), 10);
const store = {
  get() { try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch { return 0; } },
  set(v) { try { localStorage.setItem(KEY, String(v)); } catch {} }
};

let pdf, ratio = 595.3 / 841.9, zoom = 0, current = 1;
const slots = [];            // {el, canvas, rendered, task, scale}
const ZOOMS = [1, 1.5, 2, 2.75, 3.5];

function baseWidth() {
  const w = root.clientWidth - 20;
  return Math.min(w, 1000);
}
function layout() {
  const w = Math.round(baseWidth() * ZOOMS[zoom]);
  for (const s of slots) {
    s.el.style.width = w + "px";
    s.el.style.height = Math.round(w * s.ratio) + "px";
  }
}

async function renderSlot(s) {
  const wantW = s.el.clientWidth;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let px = Math.min(wantW * dpr, 2600);
  if (s.rendered === px || s.task) return;
  const page = await pdf.getPage(s.n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: px / vp1.width });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  s.task = page.render({ canvasContext: c.getContext("2d"), viewport: vp });
  try {
    await s.task.promise;
    if (s.canvas) { s.canvas.width = 0; s.canvas.remove(); }
    s.canvas = c; s.el.appendChild(c); s.rendered = px;
    s.ph.style.display = "none";
  } catch (e) { c.width = 0; }
  s.task = null;
}
function releaseSlot(s) {
  if (s.task) { s.task.cancel(); s.task = null; }
  if (s.canvas) { s.canvas.width = 0; s.canvas.remove(); s.canvas = null; }
  s.rendered = 0; s.ph.style.display = "";
}

let near, far;
function observe() {
  near?.disconnect(); far?.disconnect();
  near = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && renderSlot(e.target._s)),
    { rootMargin: "120% 0px" });
  far = new IntersectionObserver(es => es.forEach(e => !e.isIntersecting && releaseSlot(e.target._s)),
    { rootMargin: "500% 0px" });
  slots.forEach(s => { near.observe(s.el); far.observe(s.el); });
}

function trackCurrent() {
  const y = window.innerHeight * 0.35;
  let best = current, bestD = Infinity;
  // binary-ish scan near current for speed
  const from = Math.max(0, current - 6), to = Math.min(slots.length, current + 6);
  const scan = (a, b) => { for (let i = a; i < b; i++) {
    const r = slots[i].el.getBoundingClientRect();
    const d = r.top <= y && r.bottom >= y ? 0 : Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y));
    if (d < bestD) { bestD = d; best = i + 1; }
  } };
  scan(from, to);
  if (bestD > window.innerHeight) { bestD = Infinity; scan(0, slots.length); }
  if (best !== current) { current = best; if (document.activeElement !== pgIn) pgIn.value = ar(current); store.set(current); }
}

function goTo(n, smooth = true) {
  n = Math.max(1, Math.min(slots.length, n));
  const bar = document.querySelector(".bar").offsetHeight;
  const top = slots[n - 1].el.getBoundingClientRect().top + window.scrollY - bar - 8;
  window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

function setZoom(z) {
  z = Math.max(0, Math.min(ZOOMS.length - 1, z));
  if (z === zoom) return;
  const keep = current;
  zoom = z; layout();
  slots.forEach(s => { if (s.canvas) { s.rendered = 0; } });
  goTo(keep, false);
  root.scrollLeft = (root.scrollWidth - root.clientWidth) / 2 * (document.dir === "rtl" ? -1 : 1);
  observe();
}

async function init() {
  try {
    pdf = await pdfjsLib.getDocument({ url: SRC, disableAutoFetch: false, disableStream: false }).promise;
  } catch (e) {
    statusEl.textContent = "تعذّر فتح الملف. جرّب تحميله من زرار التحميل.";
    return;
  }
  const first = await pdf.getPage(1);
  const v = first.getViewport({ scale: 1 });
  ratio = v.height / v.width;
  statusEl.remove();
  pgTotal.textContent = ar(pdf.numPages);
  for (let n = 1; n <= pdf.numPages; n++) {
    const el = document.createElement("div");
    el.className = "page"; el.id = "p" + n;
    const ph = document.createElement("div"); ph.className = "ph"; ph.textContent = ar(n);
    el.appendChild(ph); root.appendChild(el);
    const s = { n, el, ph, canvas: null, rendered: 0, task: null, ratio };
    el._s = s; slots.push(s);
  }
  layout(); observe();
  pgIn.value = ar(1);

  const last = store.get();
  const hashN = toNum((location.hash.match(/p(\d+)/) || [])[1]);
  if (hashN) goTo(hashN, false);
  else if (last > 2) { resumeBtn.textContent = "كمّل من صفحة " + ar(last); resumeBtn.hidden = false;
    resumeBtn.onclick = () => { goTo(last); resumeBtn.hidden = true; }; setTimeout(() => resumeBtn.hidden = true, 12000); }

  let t; window.addEventListener("scroll", () => { if (!t) t = requestAnimationFrame(() => { t = null; trackCurrent(); }); }, { passive: true });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { const k = current; layout(); slots.forEach(s => s.rendered = 0); observe(); goTo(k, false); }, 200); });
}

document.getElementById("zin").onclick = () => setZoom(zoom + 1);
document.getElementById("zout").onclick = () => setZoom(zoom - 1);
document.getElementById("prev").onclick = () => goTo(current - 1);
document.getElementById("next").onclick = () => goTo(current + 1);
pgIn.addEventListener("focus", () => pgIn.select());
pgIn.addEventListener("change", () => { const n = toNum(pgIn.value); if (n) goTo(n); pgIn.blur(); });
pgIn.addEventListener("keydown", e => { if (e.key === "Enter") pgIn.dispatchEvent(new Event("change")); });

init();
