// BuAgent web app: reads app.json (published by the BuAgent GitHub Action to a secret gist) and shows
// exams, homework, lecture changes and to-dos. The gist id comes from the link: ?d=<gist id>.

const TZ = "Europe/Istanbul";
const TITLES = { attention: "Attention", exams: "Exams", hw: "HW", lectures: "Lectures" };
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep working */ }
  },
};

const params = new URLSearchParams(location.search);
const gistId = params.get("d") || store.get("gist", "");
if (params.get("d")) store.set("gist", params.get("d"));

let data = store.get("data", null);
let tab = store.get("tab", "attention");
let done = new Set(store.get("done", []));
let loadError = "";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- dates (always Istanbul time, whatever the phone's zone) ----
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
const fmtDay = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
const fmtTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
function relDay(d) {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  const k = dayKey(d);
  return k === today ? "Today" : k === tomorrow ? "Tomorrow" : fmtDay(d);
}
const dateOnly = (s) => new Date(`${s}T12:00:00+03:00`); // a YYYY-MM-DD day in Istanbul

function itemEnd(item) {
  const at = new Date(item.at);
  return item.all_day ? new Date(`${dayKey(at)}T23:59:59+03:00`) : at;
}
const upcoming = (item) => itemEnd(item) >= new Date();

// ---- data ----
async function load() {
  $("refresh").classList.add("spin");
  try {
    if (!gistId && !params.get("file")) throw new Error("Open BuAgent from your personal link (it ends with ?d=…).");
    let json;
    if (params.get("file")) {
      json = await (await fetch(params.get("file"), { cache: "no-store" })).json();
    } else {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load data (${res.status}).`);
      const file = (await res.json()).files["app.json"];
      json = file.truncated ? await (await fetch(file.raw_url, { cache: "no-store" })).json() : JSON.parse(file.content);
    }
    data = json;
    store.set("data", data);
    loadError = "";
  } catch (e) {
    loadError = e.message || "Could not load data.";
  } finally {
    $("refresh").classList.remove("spin");
    render();
  }
}

// ---- cards ----
const count = (posts) => (posts && posts.length ? `<span class="count">${posts.length}</span>` : "");

function itemCard(item, { showLocation } = {}) {
  const at = new Date(item.at);
  const meta = showLocation ? `<div class="meta">📍 ${esc(item.location || "–")}</div>` : "";
  const time = item.all_day ? "All day" : fmtTime(at);
  return `<button class="card" data-open="item:${esc(item.key)}">
    <div class="main"><div class="course">${esc(item.course)}</div>
      <div class="name">${esc(item.name)}${count(item.posts)}</div>${meta}</div>
    <div class="side"><div class="when">${esc(relDay(at))}</div><div class="time">${esc(time)}</div></div>
    <span class="chev">›</span></button>`;
}

function lectureCard(l) {
  const day = dateOnly(l.date);
  const time = l.start ? `${l.start}${l.end ? "–" + l.end : ""}` : "";
  const warn = ["Cancelled", "Online"].includes(l.type) ? " warn" : "";
  return `<button class="card" data-open="lecture:${esc(l.id)}">
    <div class="main"><div class="course">${esc(l.course)}</div>
      <div class="name"><span class="badge${warn}">${esc(l.type)}</span>${count(l.posts)}</div>
      ${l.location ? `<div class="meta">📍 ${esc(l.location)}</div>` : ""}</div>
    <div class="side"><div class="when">${esc(relDay(day))}</div><div class="time">${esc(time)}</div></div>
    <span class="chev">›</span></button>`;
}

function todoCard(t) {
  const due = t.due ? `<div class="meta">Due ${esc(relDay(dateOnly(t.due)))}</div>` : "";
  return `<div class="card todo" data-open="todo:${esc(t.id)}" role="button">
    <div class="main"><div class="course">${esc(t.course)}</div><div class="name">${esc(t.text)}</div>${due}</div>
    <button class="done-btn" data-done="${esc(t.id)}">Done</button></div>`;
}

const section = (title) => `<div class="section">${esc(title)}</div>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;

// ---- tabs ----
function attentionView() {
  const todos = data.todos.filter((t) => !done.has(t.id))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const limit = new Date(Date.now() + 7 * 86400000);
  const events = [
    ...data.items.filter((i) => upcoming(i) && new Date(i.at) <= limit)
      .map((i) => ({ at: new Date(i.at), html: itemCard(i, { showLocation: i.tab === "exams" }) })),
    ...data.lectures.filter((l) => dateOnly(l.date) <= limit)
      .map((l) => ({ at: new Date(`${l.date}T${l.start || "00:00"}:00+03:00`), html: lectureCard(l) })),
  ].sort((a, b) => a.at - b.at);

  let html = section("To do") + (todos.length ? todos.map(todoCard).join("") : empty("Nothing to do by hand."));
  html += section("Next 7 days");
  if (!events.length) return html + empty("Nothing in the next 7 days.");
  let lastDay = "";
  for (const e of events) {
    const d = relDay(e.at);
    if (d !== lastDay) { html += `<div class="section">${esc(d)}</div>`; lastDay = d; }
    html += e.html;
  }
  return html;
}

function listView(tabName, emptyText) {
  const items = data.items.filter((i) => i.tab === tabName && upcoming(i));
  return items.length ? items.map((i) => itemCard(i, { showLocation: tabName === "exams" })).join("") : empty(emptyText);
}

function lecturesView() {
  return data.lectures.length ? data.lectures.map(lectureCard).join("") : empty("No lecture changes announced.");
}

function render() {
  $("title").textContent = TITLES[tab];
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const updated = data ? `Updated ${relDay(new Date(data.updated))} ${fmtTime(new Date(data.updated))}` : "";
  $("updated").textContent = updated;
  let html = loadError ? `<div class="error">${esc(loadError)}</div>` : "";
  if (!data) { $("list").innerHTML = html || empty("Loading…"); return; }
  html += { attention: attentionView, exams: () => listView("exams", "No upcoming exams."),
            hw: () => listView("hw", "No upcoming deadlines."), lectures: lecturesView }[tab]();
  $("list").innerHTML = html;
}

// ---- detail ----
function postsHtml(posts) {
  const announcements = posts.filter((p) => p.source !== "Syllabus");
  const syllabus = posts.filter((p) => p.source === "Syllabus");
  const one = (p) => `<div class="post">
      <div class="post-head"><span class="badge">${esc(p.source)}</span>
        ${p.date ? `<span>${esc(fmtDay(new Date(p.date)))}${p.edited ? " · edited" : ""}</span>` : ""}</div>
      <div class="post-title">${esc(p.title)}</div>
      <div class="post-text">${esc(p.text)}</div>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open in Moodle ›</a>` : ""}</div>`;
  let html = section("Announcements") + (announcements.length ? announcements.map(one).join("") : empty("No announcements about this yet."));
  if (syllabus.length) html += section("From the syllabus") + syllabus.map(one).join("");
  return html;
}

const fact = (k, v) => `<div class="fact"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;

function openDetail(ref) {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  let head = "";
  let posts = [];
  if (kind === "item") {
    const i = data.items.find((x) => x.key === id);
    if (!i) return;
    const at = new Date(i.at);
    const label = i.kind === "deadline" ? "Deadline" : "Date";
    head = `<div class="d-course">${esc(i.course)}</div><div class="d-name">${esc(i.name)}</div><div class="facts">
      ${fact(label, fmtDay(at))}${fact("Time", i.all_day ? "All day" : fmtTime(at))}
      ${i.tab === "exams" ? fact("Location", i.location || "–") : ""}</div>
      ${i.url ? `<a class="link" href="${esc(i.url)}" target="_blank" rel="noopener">Open in Moodle ›</a>` : ""}`;
    posts = i.posts;
  } else if (kind === "lecture") {
    const l = data.lectures.find((x) => x.id === id);
    if (!l) return;
    head = `<div class="d-course">${esc(l.course)}</div><div class="d-name">${esc(l.type)}</div><div class="facts">
      ${fact("Date", fmtDay(dateOnly(l.date)))}${l.start ? fact("Time", `${l.start}${l.end ? "–" + l.end : ""}`) : ""}
      ${l.location ? fact("Location", l.location) : ""}</div>
      ${l.text ? `<div class="post" style="margin-top:12px"><div class="post-text">${esc(l.text)}</div></div>` : ""}`;
    posts = l.posts;
  } else {
    const t = data.todos.find((x) => x.id === id);
    if (!t) return;
    head = `<div class="d-course">${esc(t.course)}</div><div class="d-name">To do</div>
      <div class="post"><div class="post-text">${esc(t.text)}</div></div>
      ${t.due ? `<div class="facts">${fact("Due", fmtDay(dateOnly(t.due)))}</div>` : ""}`;
    posts = t.posts;
  }
  $("back-label").textContent = TITLES[tab];
  $("detail-body").innerHTML = head + postsHtml(posts || []);
  $("detail").scrollTop = 0;
  $("detail").classList.add("open");
  $("detail").setAttribute("aria-hidden", "false");
}

function closeDetail() {
  $("detail").classList.remove("open");
  $("detail").setAttribute("aria-hidden", "true");
}

// ---- done, with a confirmation ----
let pendingDone = null;
function askDone(id) {
  const t = data.todos.find((x) => x.id === id);
  pendingDone = id;
  $("sheet-text").textContent = t ? `${t.course}: ${t.text}` : "";
  $("sheet").classList.add("open");
}
function closeSheet() { $("sheet").classList.remove("open"); pendingDone = null; }

// ---- events ----
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  store.set("tab", tab);
  closeDetail();
  render();
  window.scrollTo(0, 0);
});
$("list").addEventListener("click", (e) => {
  const d = e.target.closest("[data-done]");
  if (d) { e.stopPropagation(); askDone(d.dataset.done); return; }
  const o = e.target.closest("[data-open]");
  if (o) openDetail(o.dataset.open);
});
$("back").addEventListener("click", closeDetail);
$("refresh").addEventListener("click", load);
$("sheet-cancel").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
$("sheet-confirm").addEventListener("click", () => {
  if (pendingDone) { done.add(pendingDone); store.set("done", [...done]); }
  closeSheet();
  render();
});

// Swipe from the left edge closes the detail view, like iOS back.
let swipeX = null;
$("detail").addEventListener("touchstart", (e) => { swipeX = e.touches[0].clientX < 30 ? e.touches[0].clientX : null; }, { passive: true });
$("detail").addEventListener("touchend", (e) => {
  if (swipeX !== null && e.changedTouches[0].clientX - swipeX > 80) closeDetail();
  swipeX = null;
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

render();
load();
