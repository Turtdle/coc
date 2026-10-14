// Lovely clan mini site. Reads data.json (rebuilt hourly by the clan bot) and renders
// everything client-side with hash routes: #/overview, #/news, #/members, #/war, #/war/<start>, #/cwl,
// #/cwl/<round>, #/cwl/history, #/cwl/history/<season>, #/streaks, #/streaks/top, #/leaderboards,
// #/player/<tag>; and, signed in, the Admin tab: #/admin[/log|/strikes|/chat|/users|/password|/setup].
//
// data.json's "war" is whatever war is on right now, a regular war or a CWL round (the
// turtdle.github.io homepage reads it too). The War tab only shows regular wars ("war" when
// it's one, else "last_war"); a CWL round shows up on the CWL tab.
"use strict";

let DATA = null;
let MEMBERS = new Map();

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => (n ?? 0).toLocaleString();
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const th = (level, cls = "") => (level ? `<img class="th ${cls}" src="img/th${level | 0}.png" alt="TH${level | 0}" title="Town Hall ${level | 0}">` : "");
const stars = (n) => [0, 1, 2].map((i) => `<img class="star" src="img/star_${i < n ? "on" : "off"}.png" alt="">`).join("");
const star = `<img class="star" src="img/star_on.png" alt="★">`;
const when = (ts, opts = { month: "short", day: "numeric" }) => (ts ? new Date(ts * 1000).toLocaleString(undefined, opts) : "");
const ago = (ts) => {
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const until = (ts) => {
  const s = Math.max(0, ts - Date.now() / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
// Progress is shown as a weekly pace only once there's a week of daily profile checks; before that,
// just the levels upgraded so far (one day projected to a week means little).
const weeklyPace = () => DATA.members.some((m) => m.progress?.days >= 7);
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const ROLES = { leader: "Leader", coLeader: "Co-leader", admin: "Elder", member: "Member" };
const ROLE_ORDER = { leader: 0, coLeader: 1, admin: 2, member: 3 };
const RESULT = { W: "Won", L: "Lost", T: "Tied", inWar: "Live", preparation: "Prep" };
const res = (r) => `<span class="res ${r}">${RESULT[r] || ""}</span>`;
// The Clash of Clans war icon: two crossed swords. Marks links that open a war.
const SWORDS = `<svg class="swords" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(45 32 32)"><path class="bl" d="M32 3L37.5 11V41h-11V11Z"/><path class="fu" d="M32 10V38"/><rect class="gd" x="19" y="40" width="26" height="6.5" rx="3.2"/><rect class="gr" x="28.8" y="46.5" width="6.4" height="10" rx="1.6"/><circle class="gd" cx="32" cy="59" r="3.8"/></g><g transform="rotate(-45 32 32)"><path class="bl" d="M32 3L37.5 11V41h-11V11Z"/><path class="fu" d="M32 10V38"/><rect class="gd" x="19" y="40" width="26" height="6.5" rx="3.2"/><rect class="gr" x="28.8" y="46.5" width="6.4" height="10" rx="1.6"/><circle class="gd" cx="32" cy="59" r="3.8"/></g></svg>`;
// A regular-war hit on a base that was already three-starred: shown, but not counted in stats.
const FREE_HIT = `<span class="free" title="That base was already three-starred, so this hit doesn't count in stats">free hit</span>`;
// A player's name, linked to their page while they're in the clan.
const who = (tag, name) => (tag && MEMBERS.has(tag) ? `<a href="#/player/${encodeURIComponent(tag)}">${esc(name)}</a>` : esc(name));
const names = (items) => `<p class="names">${items.map((x) => `<span class="n">${x}</span>`).join("")}</p>`;
// Figures in a row between rules: [[value html, label, class], ...]; falsy entries are skipped.
const ledger = (items, cls = "") => `<div class="ledger ${cls}"><div class="in">${items.filter(Boolean)
  .map(([value, label, cls = ""]) => `<div><b class="${cls}">${value}</b><span>${esc(label)}</span></div>`).join("")}</div></div>`;

// Member events: [{ts, tag, name, kind, old, new, by?}]. data.json only has the good news (joins,
// promotions, Town Hall upgrades, renames, milestones); the admin side adds leaves, demotions and
// warnings, with who did it.
function eventText(e) {
  const n = `<b>${who(e.tag, e.name)}</b>`, role = (r) => esc(ROLES[r] || r || "?");
  const text = {
    join: () => `${n} joined the clan ${th(e.new, "small")}`,
    rejoin: () => `${n} came back to the clan`,
    leave: () => `${n} left the clan`,
    promote: () => `${n} was promoted to ${role(e.new)}`,
    demote: () => `${n} was demoted to ${role(e.new)}`,
    th: () => `${n} upgraded to Town Hall ${esc(e.new)} ${th(e.new, "small")}`,
    rename: () => `<b>${esc(e.old)}</b> is now called ${n}`,
    milestone: () => `${n} ${esc(String(e.new || "").replace(/\s*\u2b50\ufe0f?\s*$/, ""))}`,
    warned: () => `${n} was warned`,
    veteran: () => `${n} is now a clan veteran${e.new ? ` <span class="muted">· ${esc(e.new)}</span>` : ""}`,
    unveteran: () => `${n} is no longer a clan veteran`,
  }[e.kind];
  return text ? text() : `${n}: ${esc(e.kind)}`;
}

function newsList(items, showBy = false) {
  if (!items.length) return `<p class="empty">Nothing yet.</p>`;
  return `<ol class="news">${items.map((e) => `<li><span class="d">${when(e.ts)}</span>
    <span>${eventText(e)}${showBy && e.by ? ` <span class="by">· ${esc(e.by)}</span>` : ""}</span></li>`).join("")}</ol>`;
}

function result(r) {
  if (r.state !== "warEnded") return ["preparation", "inWar"].includes(r.state) ? r.state : "";
  const a = [r.stars[0], r.pct[0]], b = [r.stars[1], r.pct[1]];
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? "W" : a[0] === b[0] && a[1] === b[1] ? "T" : "L";
}

function seasonName(s) {
  const [y, m] = (s || "").split("-");
  return m ? new Date(+y, +m - 1).toLocaleString(undefined, { month: "long", year: "numeric" }) : esc(s);
}

// A sortable table: columns = [{label, key(row) -> sort value, html(row), num}]
function table(rows, columns, sortKey = null, sortDir = -1, rowClass = () => "", cls = "") {
  const id = `t${Math.random().toString(36).slice(2)}`;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    let state = { col: sortKey, dir: sortDir };
    const heads = el.querySelectorAll("th");
    const draw = () => {
      const sorted = [...rows];
      if (state.col !== null) {
        const key = columns[state.col].key;
        sorted.sort((a, b) => {
          const x = key(a), y = key(b);
          return (x < y ? -1 : x > y ? 1 : 0) * state.dir;
        });
      }
      el.querySelector("tbody").innerHTML = sorted
        .map((r) => `<tr class="${rowClass(r)}">${columns.map((c) => `<td class="${c.num ? "num" : ""} ${c.center ? "mid" : ""} ${c.wrap ? "wrap" : ""}">${c.html(r)}</td>`).join("")}</tr>`)
        .join("");
      heads.forEach((h, i) => (i === state.col ? (h.dataset.dir = state.dir) : delete h.dataset.dir));
    };
    heads.forEach((h, i) =>
      h.addEventListener("click", () => {
        if (!columns[i].key) return;
        state = { col: i, dir: state.col === i ? -state.dir : -1 };
        draw();
      })
    );
    draw();
  });
  return `<div class="sheet"><table id="${id}" class="${cls}"><thead><tr>${columns
    .map((c) => `<th class="${c.num ? "num" : ""} ${c.center ? "mid" : ""} ${c.key ? "sort" : ""}">${esc(c.label)}</th>`)
    .join("")}</tr></thead><tbody></tbody></table></div>`;
}

// Ranked names: items = [[{tag, name, th?}, value html, detail], ...]
function rankList(items) {
  if (!items.length) return `<p class="empty">Nothing recorded yet.</p>`;
  return `<ol class="ranks">${items
    .map(([m, value, detail], i) => `<li><span class="rank r${i + 1}">${i + 1}</span>
      <span class="who">${th(m.th ?? MEMBERS.get(m.tag)?.th, "small")} ${who(m.tag, m.name)}<small>${esc(detail)}</small></span>
      <b class="value ${i ? "" : "gold"}">${value}</b></li>`)
    .join("")}</ol>`;
}

// ---------------------------------------------------------------- wars
function scoreboard(w, href = null) {
  const status = {
    preparation: w.start ? `Preparation day · battle starts in <b>${until(w.start)}</b>` : "Preparation day",
    inWar: w.end ? `Battle day · ends in <b>${until(w.end)}</b>` : "Battle day",
    warEnded: w.end ? `Ended ${ago(w.end)}` : "Final",
  }[w.state] || "";
  const what = w.kind === "cwl" ? `CWL round ${w.round}` : `${w.us.size} v ${w.them.size} war`;
  const side = (s, cls) => {
    const badge = s.badge ? `<img class="cb" src="${esc(s.badge)}" alt="">` : "";
    const line = [`${(s.pct || 0).toFixed(1)}%`, s.used != null ? `${s.used}/${s.total} attacks` : ""].filter(Boolean).join(" · ");
    const name = `<span class="clan">${esc(s.name)}<small>${line}</small></span>`;
    return `<div class="side ${cls}">${cls === "us" ? badge + name : name + badge}</div>`;
  };
  const pts = w.state === "preparation" ? `<span class="dash">vs</span>` : `${w.us.stars}${star}${w.them.stars}`;
  const inner = `<p class="status">${esc(what)} · ${status}</p>
    <div class="sb">${side(w.us, "us")}<div class="pts">${pts}</div>${side(w.them, "them")}</div>`;
  return href ? `<a class="now scoreboard" href="${href}">${inner}<span class="sb-go">${SWORDS}Open the war <span aria-hidden="true">→</span></span></a>`
    : `<div class="scoreboard">${inner}</div>`;
}

function lineupTable(lineup, pending) {
  return table(lineup, [
    { label: "#", key: (m) => m.pos, html: (m) => `<span class="muted">${m.pos}</span>` },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => `${th(m.th)} ${who(m.tag, m.name)}` },
    {
      label: "Attacks", key: (m) => m.attacks.reduce((s, a) => s + a.stars, 0),
      html: (m) => (m.attacks.length ? m.attacks.map((a) => `<span class="muted">→ #${a.pos ?? "?"}</span> ${th(a.th, "small")} ${stars(a.stars)} <b class="${a.pct >= 100 ? "gold" : ""}">${Math.round(a.pct)}%</b>${a.free ? ` ${FREE_HIT}` : ""}`).join("<br>") : `<span class="muted">${pending}</span>`),
    },
    {
      // Every enemy hit on the base, in order: held (not three-starred) in green, three-starred in red.
      label: "Defense", key: (m) => -m.defense.stars,
      html: (m) => (m.defense.hits?.length
        ? m.defense.hits.map((d) => `<span class="muted">← #${d.pos ?? "?"}</span> ${th(d.th, "small")} <span class="${d.stars < 3 ? "win" : "loss"}">${stars(d.stars)} ${Math.round(d.pct)}%</span>${d.free ? ` ${FREE_HIT}` : ""}`).join("<br>")
        : m.defense.n ? `<span class="${m.defense.stars < 3 ? "win" : "loss"}">${stars(m.defense.stars)} ${Math.round(m.defense.pct)}%</span>${m.defense.n > 1 ? ` <span class="muted">· hit ${m.defense.n}×</span>` : ""}` : `<span class="muted">not attacked</span>`),
    },
  ], 0, 1);  // map position, top first
}

// Everything under a war's scoreboard: attacks left, who still has to attack, the line-up.
function warBody(w) {
  if (w.state === "preparation") return `<p class="note">${w.start ? `Preparation day: attacks open in ${until(w.start)}.` : "Preparation day: the line-up is set."}</p>`;
  const live = w.state === "inWar";
  const left = w.lineup.filter((m) => m.attacks.length < w.per);
  const hit = w.lineup.filter((m) => m.defense.n), held = hit.filter((m) => m.defense.stars < 3);
  let html = ledger([
    [num(w.us.total - w.us.used), live ? "our attacks left" : "attacks missed", live ? "gold" : w.us.total > w.us.used ? "loss" : ""],
    [hit.length ? `${held.length}<span class="muted">/${hit.length}</span>` : "–", "bases held"],
    w.them.used != null && [num(w.them.total - w.them.used), live ? "enemy attacks left" : "enemy attacks missed"],
  ]);
  if (w.state === "warEnded") {  // the recap: best attackers and the bases that held
    const scored = w.lineup.map((m) => ({ m, hits: m.attacks.filter((a) => !a.free) })).filter((x) => x.hits.length).map(({ m, hits }) => ({
      m, s: hits.reduce((t, a) => t + a.stars, 0), d: hits.reduce((t, a) => t + a.pct, 0), x: hits.filter((a) => a.stars === 3).length,
    })).sort((a, b) => b.s - a.s || b.d - a.d).slice(0, 3);
    if (scored.length) html += `<h3>Best attacks</h3>` + names(scored.map(({ m, s, x }) => `${th(m.th, "small")} ${who(m.tag, m.name)} <b>${s}</b>${star}${x > 1 ? ` <span class="muted">${x} triples</span>` : ""}`));
    // Every base that held off at least one hit (counted hits only), not just the ones never three-starred.
    const holds = w.lineup.map((m) => ({ m, hits: (m.defense.hits || []).filter((d) => !d.free) }))
      .map(({ m, hits }) => ({ m, n: hits.length, held: hits.filter((d) => d.stars < 3).length })).filter((x) => x.held)
      .sort((a, b) => b.held - a.held || a.m.pos - b.m.pos);
    if (holds.length) {
      html += `<h3>Held off hits (${holds.reduce((s, x) => s + x.held, 0)})</h3>` + names(holds.map(({ m, n, held: h }) =>
        `${th(m.th, "small")} ${who(m.tag, m.name)} <span class="muted">${h} of ${n}${h === n ? ", never three-starred" : ""}</span>`));
    } else if (held.length) html += `<h3>Held (${held.length})</h3>` + names(held.map((m) => `${th(m.th, "small")} ${who(m.tag, m.name)}`));
  }
  if (left.length) {
    const label = live ? "Still to attack" : "Didn't attack";
    html += `<h3>${label} (${left.length})</h3>` + names(left.map((m) => `${th(m.th, "small")} ${who(m.tag, m.name)}${w.per - m.attacks.length > 1 ? ` <span class="muted">×${w.per - m.attacks.length}</span>` : ""}`));
  }
  return html + `<h2>Line-up</h2>${lineupTable(w.lineup, live ? "no attack yet" : "no attack")}`;
}

// ---------------------------------------------------------------- pages
function overview() {
  const c = DATA.clan, live = DATA.war, cwl = DATA.cwl;
  let html = c.description ? `<p class="lede">${esc(c.description)}</p>` : "";
  html += ledger([
    [esc(c.war_league || "–"), "war league"],
    [num(c.win_streak), "war win streak", "gold"],
    [`${num(c.record[0])}–${num(c.record[1])}–${num(c.record[2])}`, "won · tied · lost"],
    [`${num(c.members)}<span class="muted">/50</span>`, "members"],
    DATA.streaks?.length && [`<a href="#/streaks">${num(DATA.streaks.length)}</a>`, "win streaks we ended"],
    [c.required_th > 1 ? `TH${num(c.required_th)}+` : "Any TH", { inviteOnly: "invite only", open: "open to join", closed: "closed" }[c.type] || "to join"],
  ], "three");
  if (c.labels.length) html += `<p class="tags">${c.labels.map(esc).join(" · ")}</p>`;

  if (live?.kind === "cwl") {
    const where = cwl?.position ? `<small>${ordinal(cwl.position)} of ${cwl.clans} in the group</small>` : "";
    html += `<h2>CWL, round ${live.round} ${where}</h2>${scoreboard(live, `#/cwl/${live.round}`)}`;
  } else if (live) {
    html += `<h2>${live.state === "warEnded" ? "Last war" : "This war"}</h2>${scoreboard(live, "#/war")}`;
  }

  const war3 = DATA.members.filter((m) => m.war.all.attacks >= 3)
    .sort((a, b) => b.war.all.triples / b.war.all.attacks - a.war.all.triples / a.war.all.attacks || b.war.all.attacks - a.war.all.attacks).slice(0, 5);
  const donors = DATA.members.filter((m) => m.donations_total).sort((a, b) => b.donations_total - a.donations_total).slice(0, 5);
  const perfect = (DATA.cwl_history?.perfect || []).slice(0, 5);
  const weekly = weeklyPace();
  const fastest = DATA.members.filter((m) => m.progress?.gained > 0)
    .sort((a, b) => (weekly ? b.progress.per_week - a.progress.per_week : b.progress.gained - a.progress.gained)).slice(0, 5);
  const gamers = DATA.members.filter((m) => m.games?.points > 0).sort((a, b) => b.games.points - a.games.points);
  const games = DATA.members.find((m) => m.games)?.games;
  html += `<div class="cols">
    <section><h2>Clan news</h2>${newsList((DATA.news || []).slice(0, 6))}
      ${(DATA.news || []).length > 6 ? `<p class="note"><a class="link" href="#/news">All the news</a></p>` : ""}</section>
    <section><h2>Best 3-star rate</h2>${rankList(war3.map((m) => [m, pct(m.war.all.triples / m.war.all.attacks), `${m.war.all.attacks} attacks`]))}</section>
    <section><h2>Top donors</h2>${rankList(donors.map((m) => [m, num(m.donations_total), `got ${num(m.received_total)}`]))}</section>
    ${perfect.length ? `<section><h2>Perfect CWLs</h2>${rankList(perfect.map((p) => [p, num(p.perfect), p.streak > 1 ? `${p.streak} in a row` : `of ${p.shown} seasons`]))}
      <p class="note"><a class="link" href="#/cwl/history">Every season</a></p></section>` : ""}
    <section><h2>Fastest progress</h2>${rankList(fastest.map((m) => [m, weekly ? `${m.progress.per_week}<span class="muted unit">/wk</span>` : `+${num(m.progress.gained)}`,
      weekly ? `+${num(m.progress.gained)} levels in ${m.progress.days} day${m.progress.days === 1 ? "" : "s"}` : `levels in ${m.progress.days} day${m.progress.days === 1 ? "" : "s"}`]))}
      <p class="note">Hero and lab (troops, spells, sieges, pets) levels upgraded ${weekly ? "a week" : "so far (a weekly pace shows once there's a week of data)"};
      buildings aren't shared by the game. <a class="link" href="#/leaderboards/progress">Everyone</a></p></section>
    <section><h2>Clan Games ${games ? `<small>${gameDates(games)}</small>` : ""}</h2>
      ${rankList(gamers.slice(0, 5).map((m) => [m, num(m.games.points), games.ongoing ? "so far" : ""]))}
      ${gamers.length ? `<p class="note">${num(gamers.reduce((t, m) => t + m.games.points, 0))} points from ${num(gamers.length)} members. <a class="link" href="#/leaderboards/games">Everyone</a></p>` : ""}</section>
  </div>`;
  return html;
}

const gameDates = (g) => {
  const day = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
  return `${day(g.start, { month: "short", day: "numeric" })}–${day(g.end, { day: "numeric" })}${g.ongoing ? ", on now" : ""}`;
};

function newsPage() {
  return `<h2>Clan news <small>the last 60 days</small></h2>${newsList(DATA.news || [])}
    <p class="note">Joins, promotions, Town Hall upgrades and war-star milestones, from the member list our clan bot reads every few minutes.</p>`;
}

function warPage(start) {
  if (start) return pastWar(+start);
  const live = DATA.war, w = live?.kind === "regular" ? live : DATA.last_war;
  let html = "";
  if (live?.kind === "cwl") {
    html += `<p class="aside">Clan War League is on: round ${live.round} is on the <a class="link" href="#/cwl">CWL page</a>. This page is for regular wars.</p>`;
  }
  if (w) {
    html += `<h2>${w.state === "warEnded" ? "Last war" : "This war"}</h2>${scoreboard(w)}${warBody(w)}`;
  } else {
    html += `<p class="empty">No regular wars recorded yet.</p>`;
  }
  if (DATA.regular_wars?.length) {
    html += `<h2>War log</h2>` + table(DATA.regular_wars, [
      { label: "Ended", key: (r) => r.end, html: (r) => `<span class="muted">${when(r.end) || "–"}</span>` },
      { label: "Result", key: null, html: (r) => res(result(r)) },
      { label: "Opponent", key: (r) => r.opponent.toLowerCase(), html: (r) => (r.lineup ? `<a class="link" href="#/war/${r.start}">${esc(r.opponent)}</a>` : esc(r.opponent)) },
      { label: "Size", key: (r) => r.size, html: (r) => `${r.size} v ${r.size}`, num: true },
      { label: "Stars", key: (r) => r.stars[0] - r.stars[1], html: (r) => `<b>${r.stars[0]}</b> – ${r.stars[1]}`, num: true },
      { label: "Destruction", key: (r) => r.pct[0], html: (r) => `${r.pct[0].toFixed(1)}% <span class="muted">– ${r.pct[1].toFixed(1)}%</span>`, num: true },
    ], 0);
  }
  return html;
}

// A finished regular war from the war log, with its recap and line-up.
function pastWar(start) {
  const r = (DATA.regular_wars || []).find((x) => x.start === start);
  const html = `<a class="back" href="#/war">← War</a>`;
  if (!r?.lineup) return html + `<p class="empty">That war's line-up isn't on record.</p>`;
  const used = r.lineup.reduce((s, m) => s + m.attacks.length, 0);
  const w = {
    state: r.state, kind: "regular", round: null, per: r.per, start: r.start, end: r.end, lineup: r.lineup,
    us: { name: DATA.clan.name, badge: DATA.clan.badge, stars: r.stars[0], pct: r.pct[0], size: r.size, used, total: r.size * r.per },
    them: { name: r.opponent, badge: null, stars: r.stars[1], pct: r.pct[1], size: r.size, used: null, total: r.size * r.per },
  };
  return html + `<h2>${res(result(r))} <span dir="auto">vs ${esc(r.opponent)}</span> <small>${when(r.end, { month: "short", day: "numeric", year: "numeric" })}</small></h2>${scoreboard(w)}${warBody(w)}`;
}

function cwlPage(a, b) {
  const sub = (on) => `<div class="subnav"><a href="#/cwl" class="${on ? "" : "on"}">This season</a><a href="#/cwl/history" class="${on ? "on" : ""}">Past seasons</a></div>`;
  if (a === "history") return sub(true) + (b ? historySeason(decodeURIComponent(b)) : historyPage());
  return sub(false) + (a ? roundPage(+a) : seasonPage());
}

// The CWL tab: the season at a glance, a big way into the war on now, then the group, the rounds
// and every member's stars round by round.
function seasonPage() {
  const c = DATA.cwl, live = DATA.war?.kind === "cwl" ? DATA.war : null;
  if (!c && !live) return `<p class="empty">No CWL recorded yet.</p>`;
  let html = "";
  if (c) {
    const done = c.rounds.length >= 7 && c.rounds.every((r) => r.state === "warEnded");
    const tally = (x) => c.rounds.filter((r) => result(r) === x).length;
    html += `<h2>${seasonName(c.season)} <small>${done ? "final" : "in progress"}</small></h2>` + ledger([
      [c.position ? ordinal(c.position) : "–", `of ${c.clans} in the group`, "gold"],
      [`${num(c.stars)}${star}`, "group stars"],
      [`${num(Math.round(c.destruction))}%`, "total destruction"],
      [`${tally("W")}–${tally("T")}–${tally("L")}`, "won · tied · lost"],
    ]);
  }
  if (live) html += warButton(live);
  if (c?.scout) html += `<p class="aside">Next up: round ${c.scout.round} against <b dir="auto">${esc(c.scout.opponent)}</b>. <a class="link" href="#/cwl/${c.scout.round}">Scout their line-up</a></p>`;
  if (!c) return html;

  const group = c.standings?.length ? `<section><h2>Group</h2><div class="sheet"><table class="group"><thead><tr>
      <th>#</th><th>Clan</th><th class="num">Stars</th><th class="num">Destruction</th></tr></thead><tbody>${c.standings.map((s, i) => `
      <tr class="${s.us ? "us" : ""}"><td><span class="rank ${i ? "" : "r1"}">${i + 1}</span></td><td dir="auto">${esc(s.name)}</td>
      <td class="num"><b>${num(s.stars)}</b> ${star}</td><td class="num muted">${num(s.destruction)}%</td></tr>`).join("")}</tbody></table></div></section>` : "";
  // Rounds: built like the Group table, with a total row, so the two sit level (8 clans, 7 rounds).
  const played = c.rounds.filter((r) => r.state !== "preparation");
  const sum = (i) => played.reduce((t, r) => t + r.stars[i], 0);
  const avg = (i) => Math.round(played.reduce((t, r) => t + r.pct[i], 0) / played.length);
  const rounds = `<section><h2>Rounds</h2><div class="sheet"><table class="rounds"><thead><tr>
      <th>#</th><th>Result</th><th>Opponent</th><th class="num">Stars</th><th class="num wide">Destruction</th></tr></thead><tbody>${c.rounds.map((r) => {
    const prep = r.state === "preparation";
    return `<tr data-href="#/cwl/${r.round}"><td><span class="rank">R${r.round}</span></td><td>${res(result(r))}</td>
      <td dir="auto"><a href="#/cwl/${r.round}">${esc(r.opponent)}</a></td>
      <td class="num">${prep ? "" : `<b>${r.stars[0]}</b> – ${r.stars[1]}`}</td>
      <td class="num muted wide">${prep ? "" : `${Math.round(r.pct[0])}% – ${Math.round(r.pct[1])}%`}</td></tr>`;
  }).join("")}${played.length ? `<tr class="total"><td colspan="3">All rounds</td><td class="num"><b>${sum(0)}</b> – ${sum(1)}</td>
      <td class="num muted wide">avg ${avg(0)}% – ${avg(1)}%</td></tr>` : ""}</tbody></table></div></section>`;
  html += `<div class="cols">${group}${rounds}</div>`;

  // Members x rounds: the stars each member got in each round.
  const totals = new Map(c.members.map((m) => [m.tag, m]));
  const people = new Map();
  for (const r of c.rounds) {
    for (const m of r.lineup) {
      const p = people.get(m.tag) || { tag: m.tag, name: m.name, th: m.th, cells: {} };
      p.cells[r.round] = m.attacks.length ? m.attacks[0].stars : { warEnded: "missed", inWar: "pending", preparation: "in" }[r.state];
      people.set(m.tag, p);
    }
  }
  const rows = [...people.values()].map((p) => ({ ...p, ...(totals.get(p.tag) || { stars: 0, destruction: 0, attacks: 0, wars: 0 }) }));
  const cell = (v) => (typeof v === "number" ? `<span class="cell s${v}">${v}</span>`
    : v === "missed" ? `<span class="cell missed" title="Missed">✗</span>`
    : v === "pending" ? `<span class="cell later" title="Hasn't attacked yet">…</span>`
    : v === "in" ? `<span class="cell later" title="In the line-up">•</span>` : "");
  html += `<h2>Members</h2><p class="note">Stars in each round (✗ missed, … still to attack, • in the next line-up). Totals count finished rounds, like the in-game Clan tab.</p>`
    + table(rows, [
      { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => `${th(m.th, "small")} ${who(m.tag, m.name)}` },
      ...c.rounds.map((r) => ({
        label: `R${r.round}`, key: (m) => (typeof m.cells[r.round] === "number" ? m.cells[r.round] : -1), html: (m) => cell(m.cells[r.round]), center: true,
      })),
      { label: "Stars", key: (m) => m.stars, html: (m) => `<b>${m.stars}</b> ${star}`, num: true },
      { label: "Destruction", key: (m) => m.destruction, html: (m) => `${num(Math.round(m.destruction))}%`, num: true },
      { label: "Hits", key: (m) => m.attacks, html: (m) => `${m.attacks}/${m.wars}`, num: true },
    ], c.rounds.length + 1, -1, () => "", "grid");
  return html;
}

// A big link into the war on now.
function warButton(w) {
  const prep = w.state === "preparation";
  const when = prep ? `preparation · battle starts in ${until(w.start)}` : `battle day · ends in ${until(w.end)}`;
  const left = w.us.total - w.us.used;
  return `<a class="war-button" href="#/cwl/${w.round}">
    <span class="wb-what">Round ${w.round} is ${prep ? "coming up" : "on now"} · ${when}</span>
    <span class="wb-vs">vs <span dir="auto">${esc(w.them.name)}</span></span>
    <span class="wb-score">${prep ? "" : `${w.us.stars}${star}${w.them.stars}`}</span>
    <span class="wb-note">${prep ? "Line-up is set" : left ? `${left} attack${left > 1 ? "s" : ""} left` : "Everyone has attacked"}</span>
    <span class="wb-go">${SWORDS}Open the war <span aria-hidden="true">→</span></span>
  </a>`;
}

function roundPage(n) {
  const c = DATA.cwl, live = DATA.war?.kind === "cwl" && DATA.war.round === n ? DATA.war : null;
  const r = c?.rounds.find((x) => x.round === n);
  const has = (k) => c?.rounds.some((x) => x.round === k);
  let html = `<div class="roundnav"><a href="#/cwl">← ${c ? seasonName(c.season) : "This season"}</a><span>
    ${has(n - 1) ? `<a href="#/cwl/${n - 1}">‹ Round ${n - 1}</a>` : ""}${has(n + 1) ? `<a href="#/cwl/${n + 1}">Round ${n + 1} ›</a>` : ""}</span></div>`;
  const scouting = c?.scout?.round === n ? scoutTable(c.scout) : "";
  if (live) return html + `<h2>Round ${n} <small>vs ${esc(live.them.name)}</small></h2>${scoreboard(live)}${warBody(live)}${scouting}`;
  if (!r) return html + `<p class="empty">No such round.</p>`;
  const used = r.lineup.reduce((s, m) => s + m.attacks.length, 0);
  const w = {
    state: r.state, kind: "cwl", round: r.round, per: 1, start: null, end: null, lineup: r.lineup,
    us: { name: DATA.clan.name, badge: DATA.clan.badge, stars: r.stars[0], pct: r.pct[0], size: r.lineup.length, used, total: r.lineup.length },
    them: { name: r.opponent, badge: null, stars: r.stars[1], pct: r.pct[1], size: r.lineup.length, used: null, total: r.lineup.length },
  };
  return html + `<h2>Round ${n} <small>vs ${esc(r.opponent)}</small></h2>${scoreboard(w)}${warBody(w)}${scouting}`;
}

// The next CWL opponent's line-up, with how each of them has done in earlier rounds this season.
function scoutTable(s) {
  const head = `<h2>Scouting <span dir="auto">${esc(s.opponent)}</span></h2>`;
  if (!s.rows.length) return head + `<p class="note">Their line-up shows up here when preparation day starts.</p>`;
  return head + `<p class="note">Their earlier rounds this season (the bot records every war in our group). Held means the base wasn't three-starred.</p>` + table(s.rows, [
    { label: "#", key: (r) => r.pos, html: (r) => `<span class="muted">${r.pos}</span>` },
    { label: "Base", key: (r) => r.name.toLowerCase(), html: (r) => `${th(r.th)} <span dir="auto">${esc(r.name)}</span>` },
    { label: "Their attacks", key: (r) => (r.hits ? r.stars / r.hits : -1), html: (r) => (r.hits ? `<b>${r.stars}</b> ${star} <span class="muted">${r.triples}×3 · ${r.hits} hit${r.hits > 1 ? "s" : ""}</span>` : `<span class="muted">no hits yet</span>`), num: true },
    { label: "Their defense", key: (r) => (r.defended ? r.held / r.defended : -1), html: (r) => (r.defended ? `<span class="${r.held ? "win" : ""}">held ${r.held}/${r.defended}</span>` : `<span class="muted">not attacked yet</span>`), num: true },
  ], 0, 1);
}

const PERFECT_MARK = `<span class="perfect" title="21 stars from 7 attacks">perfect</span>`;

// A member's CWL record over every season we have: perfect seasons (21 stars from 7 attacks), how
// many in a row up to the latest finished one, and how many seasons they made the board.
function cwlRecord(tag) {
  const h = DATA.cwl_history, p = h?.perfect.find((x) => x.tag === tag);
  const rows = (h?.seasons || []).flatMap((s) => s.rows.filter((r) => r.tag === tag).map((r) => ({ ...r, s })));
  return { perfect: p?.perfect || 0, streak: p?.streak || 0, shown: rows.filter((r) => r.s.done).length, rows };
}

function historyPage() {
  const h = DATA.cwl_history;
  if (!h?.seasons.length) return `<p class="empty">No past seasons yet.</p>`;
  let html = `<h2>Seasons</h2>
    <p class="note">Older seasons come from the leaderboard screenshots posted in our Discord, which only show the top of the board.
    The bot has recorded every member since October 2026. Each member's perfect CWLs are on the <a class="link" href="#/members">Members</a> list and their own page.</p>`;
  html += table(h.seasons, [
    { label: "Season", key: (s) => s.season, html: (s) => `<a class="link" href="#/cwl/history/${encodeURIComponent(s.season)}">${esc(s.label)}</a>` },
    {
      label: "Finish", key: (s) => (s.finish?.place ? -s.finish.place : -99),
      html: (s) => (s.finish?.place ? `${ordinal(s.finish.place)}${s.finish.movement === "up" ? ` <span class="win" title="promoted">▲</span>` : s.finish.movement === "down" ? ` <span class="loss" title="demoted">▼</span>` : ""} <span class="muted">${esc(s.finish.league)}</span>` : `<span class="muted">–</span>`),
    },
    { label: "Perfect", key: (s) => s.rows.filter((r) => r.perfect).length, html: (s) => (s.done && s.source !== "log" ? num(s.rows.filter((r) => r.perfect).length) : `<span class="muted">–</span>`), num: true },
    {
      label: "Top of the board", key: null, wrap: true,
      html: (s) => {
        const perfect = s.rows.filter((r) => r.perfect), top = perfect.length ? perfect : s.rows.filter((r) => r.position === 1);
        if (!top.length) return s.finish ? `<span class="muted">clan totals only · ${num(s.finish.stars)}${star}</span>` : "";
        const shown = top.slice(0, 4).map((r) => who(r.tag, r.now || r.name)).join(", ");
        const more = top.length > 4 ? ` <span class="muted">+${top.length - 4} more</span>` : "";
        return perfect.length ? shown + more : `${shown}${more} <span class="muted">· ${top[0].stars}${star}</span>`;
      },
    },
    { label: "", key: null, wrap: true, html: (s) => (s.result ? esc(s.result) : s.done ? "" : `<span class="muted">in progress</span>`) },
  ], 0);
  return html;
}

function historySeason(key) {
  const s = DATA.cwl_history?.seasons.find((x) => x.season === key);
  let html = `<a class="back" href="#/cwl/history">← Past seasons</a>`;
  if (!s) return html + `<p class="empty">No such season.</p>`;
  const perfect = s.rows.filter((r) => r.perfect).length;
  const source = s.source === "screenshot"
    ? "From the leaderboard screenshot posted after the season, so only the top of the board."
    : s.source === "log" ? "Only the clan's totals for this season, from the war log."
    : s.done ? "Recorded by the clan bot." : "Still going: finished rounds only.";
  const f = s.finish;
  html += `<h2>${esc(s.label)} ${s.result ? `<small>${esc(s.result)}</small>` : ""}</h2>`;
  if (f) {
    html += ledger([
      [f.place ? ordinal(f.place) : "–", f.place ? `${f.movement === "up" ? "promoted from" : f.movement === "down" ? "demoted from" : "in"} ${f.league}` : "place not known", "gold"],
      [`${num(f.stars)}${star}`, "clan stars"],
      [`${num(f.destruction)}%`, "total destruction"],
      [`${num(f.attacks)}/${num(f.team_size * 7)}`, `attacks (${f.team_size} v ${f.team_size})`],
    ]);
  }
  html += `<p class="note">${source}${perfect ? ` ${perfect} perfect.` : ""}${s.note ? ` ${esc(s.note)}` : ""}</p>`;
  if (!s.rows.length) return html;
  return html + table(s.rows, [
    { label: "#", key: (r) => r.position, html: (r) => `<span class="rank ${r.position === 1 ? "r1" : ""}">${r.position}</span>` },
    {
      label: "Member", key: (r) => (r.now || r.name).toLowerCase(),
      html: (r) => `${th(MEMBERS.get(r.tag)?.th, "small")} ${who(r.tag, r.now || r.name)}${r.now ? ` <span class="was">then ${esc(r.name)}</span>` : ""}${r.perfect ? ` ${PERFECT_MARK}` : ""}`,
    },
    { label: "Stars", key: (r) => r.stars, html: (r) => `<b>${r.stars}</b> ${star}`, num: true },
    { label: "Destruction", key: (r) => r.destruction, html: (r) => `${num(r.destruction)}%`, num: true },
    { label: "Attacks", key: (r) => r.attacks, html: (r) => `${r.attacks}/${r.available}`, num: true },
  ], 0, 1, (r) => (MEMBERS.has(r.tag) ? "" : "left"));
}

// Enemy war win streaks we ended (the bot's /streaks), with the screenshots as proof.
function streaksPage(order) {
  const all = DATA.streaks || [];
  if (!all.length) return `<p class="empty">No destroyed streaks logged yet.</p>`;
  const top = order === "top";
  const list = [...all].sort(top ? (a, b) => b.streak - a.streak || b.date.localeCompare(a.date) : (a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  let html = ledger([
    [num(all.length), "win streaks destroyed", "gold"],
    [num(all.reduce((s, x) => s + x.streak, 0)), "enemy wins in a row, ended"],
    [num(Math.max(...all.map((x) => x.streak))), "the biggest"],
  ]);
  html += `<div class="subnav"><a href="#/streaks" class="${top ? "" : "on"}">Newest</a><a href="#/streaks/top" class="${top ? "on" : ""}">Biggest</a></div>`;
  html += `<div class="streaks">${list.map((s, i) => `<article>
      <div class="len">${top ? `<span class="rank ${i ? "" : "r1"}">${i + 1}</span>` : ""}<b>${num(s.streak)}</b><span>wins</span></div>
      <div class="what"><h3 dir="auto">${esc(s.clan)}</h3><p>Ended ${day(s.date)}${s.note ? ` · ${esc(s.note)}` : ""}</p></div>
      <div class="proof">${s.shots.map((src, n) => `<a class="shot" href="${esc(src)}" data-id="${s.id}" data-i="${n}" title="Screenshot ${n + 1}"><img src="${esc(src.replace(/\.webp$/, "-t.webp"))}" alt="Proof screenshot ${n + 1}" loading="lazy"></a>`).join("")}</div>
    </article>`).join("")}</div>
    <p class="note">Logged in our Discord with <b>/streaks add</b>. Tap a screenshot for the full size.</p>`;
  return html;
}

function membersPage() {
  const rows = DATA.members.map((m) => ({ ...m, cwl: cwlRecord(m.tag) }));
  const ra = clanRange("all", "attack"), rd = clanRange("all", "defense");
  return `<h2>${num(DATA.members.length)} members</h2>
    <p class="note">Donations are everything given since the bot started counting, so they don't reset each season.
    Ratings are points per hit, weighed by the Town Hall gap and level (see a member's page); they're coloured from the
    clan's lowest (red) to highest (green).</p>` + table(rows, [
    { label: "TH", key: (m) => m.th, html: (m) => th(m.th) },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => who(m.tag, m.name) + vetMark(m) },
    { label: "Role", key: (m) => -ROLE_ORDER[m.role], html: (m) => `<span class="role ${esc(m.role)}">${ROLES[m.role] || ""}</span>` },
    { label: "League", key: (m) => m.league_id ?? -1, html: (m) => (m.league_icon ? `<img class="league" src="${esc(m.league_icon)}" alt="${esc(m.league || "")}" title="${esc(m.league || "")}">` : `<span class="muted" title="Unranked">–</span>`) },
    { label: "Atk rating", key: (m) => (m.war.all.attacks ? m.war.all.attack_rating : -1), html: (m) => (m.war.all.attacks && typeof m.war.all.attack_rating === "number" ? toned(m.war.all.attack_rating, ra, pts(m.war.all.attack_rating)) : "–"), num: true },
    { label: "Def rating", key: (m) => (m.defense.all.attacked ? m.defense.all.defense_rating : -1), html: (m) => (m.defense.all.attacked && typeof m.defense.all.defense_rating === "number" ? toned(m.defense.all.defense_rating, rd, pts(m.defense.all.defense_rating)) : "–"), num: true },
    { label: "Donated", key: (m) => m.donations_total ?? -1, html: (m) => (m.donations_total == null ? `<span class="muted">–</span>` : `<b>${num(m.donations_total)}</b>`), num: true },
    { label: "3★ rate", key: (m) => (m.war.all.attacks ? m.war.all.triples / m.war.all.attacks : -1), html: (m) => (m.war.all.attacks ? pct(m.war.all.triples / m.war.all.attacks) : "–"), num: true },
    { label: "Held", key: (m) => (m.defense.all.attacked ? m.defense.all.held / m.defense.all.attacked : -1), html: (m) => (m.defense.all.attacked ? pct(m.defense.all.held / m.defense.all.attacked) : "–"), num: true },
    { label: "Perfect CWLs", key: (m) => m.cwl.perfect * 100 + m.cwl.streak, html: (m) => (m.cwl.perfect ? `<span class="perfect-n">${m.cwl.perfect}</span>${m.cwl.streak ? ` <span class="muted">· ${m.cwl.streak} in a row</span>` : ""}` : `<span class="muted">–</span>`), num: true },
  ], 2);
}

const METRICS = {
  attack_rating: ["Attack rating", (s) => s.attacks >= 3 && s.attack_rating, (v) => pts(v), (s) => `${s.attacks} attacks · ${s.up} up`],
  defense_rating: ["Defense rating", (s, d) => d.attacked >= 3 && d.defense_rating, (v) => pts(v), (s, d) => `held ${d.held} of ${d.attacked}`],
  triple_rate: ["3-star rate", (s) => s.attacks >= 3 && s.triples / s.attacks, (v) => pct(v), (s) => `${s.attacks} attacks`],
  avg_stars: ["Average stars", (s) => s.attacks >= 3 && s.avg_stars, (v) => v.toFixed(2) + " " + star, (s) => `${s.attacks} attacks`],
  stars: ["Total stars", (s) => s.attacks && s.triples * 3 + s.by_stars[2] * 2 + s.by_stars[1], (v) => `${v} ${star}`, (s) => `${s.attacks} attacks`],
  missed: ["Missed attacks", (s) => s.missed || false, (v) => v, (s) => `${s.wars} wars`],
  hold_rate: ["Defense hold rate", (s, d) => d.attacked >= 3 && d.held / d.attacked, (v) => pct(v), (s, d) => `held ${d.held} of ${d.attacked}`],
  donations_total: ["Donations", null, (v) => num(v), null],
  progress: ["Fastest progress", null, (v) => `${v}/week`, null],
  games: ["Clan Games points", null, (v) => num(v), null],
};
// Leaderboards that aren't about wars (the war filter doesn't apply).
const NOT_WARS = new Set(["donations_total", "progress", "games"]);

function leaderboardsPage(metric = "attack_rating", scope = "all") {
  if (!METRICS[metric]) metric = "attack_rating";
  const [label, value, metricFmt, detail] = METRICS[metric];
  const fmt = metric === "progress" && !weeklyPace() ? (v) => `+${num(v)}` : metricFmt;
  let rows;
  if (metric === "donations_total") rows = DATA.members.filter((m) => m.donations_total != null).map((m) => [m, m.donations_total, `got ${num(m.received_total)}`]);
  else if (metric === "progress") rows = DATA.members.filter((m) => m.progress).map((m) => (weeklyPace()
    ? [m, m.progress.per_week, `+${m.progress.gained} levels in ${m.progress.days} day${m.progress.days === 1 ? "" : "s"}`] : [m, m.progress.gained, `levels in ${m.progress.days} day${m.progress.days === 1 ? "" : "s"}`]));
  else if (metric === "games") rows = DATA.members.filter((m) => m.games).map((m) => [m, m.games.points, m.games.ongoing ? "still going" : `${m.games.start.slice(5)} to ${m.games.end.slice(5)}`]);
  else rows = DATA.members.map((m) => [m, value(m.war[scope], m.defense[scope]), detail(m.war[scope], m.defense[scope])]).filter((r) => r[1] !== false && r[1] !== 0);
  rows.sort((a, b) => b[1] - a[1]);
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join("");
  setTimeout(() => {
    const go = () => { location.hash = `#/leaderboards/${document.getElementById("metric").value}/${document.getElementById("scope").value}`; };
    document.getElementById("metric").onchange = go;
    document.getElementById("scope").onchange = go;
  });
  return `<div class="controls"><select id="metric" aria-label="Stat">${opts(METRICS, metric)}</select><select id="scope" aria-label="Wars" ${NOT_WARS.has(metric) ? "disabled" : ""}>${opts({ all: "All wars", cwl: "CWL", regular: "Regular wars" }, scope)}</select></div>
    <h2>${esc(label)}</h2>${rankList(rows.slice(0, 25).map(([m, v, d]) => [m, metric.endsWith("_rating") ? toned(v, { lo: rows[rows.length - 1][1], hi: rows[0][1] }, fmt(v)) : fmt(v), d]))}
    <p class="note">Rates and averages need at least 3 attacks (or defenses). War stats come from wars the bot has recorded.
    In regular wars, a hit on a base that was already three-starred is a free hit and doesn't count; in CWL every hit counts.</p>`;
}

// Donated vs received as one bar split between the two, with the ratio and the member's place in the clan.
function givePanel(m) {
  const given = m.donations_total || 0, got = m.received_total || 0;
  const head = `<h3>Donations <small>since ${esc(when(m.tracked_since, { month: "short", day: "numeric", year: "numeric" }))}</small></h3>`;
  if (!given && !got) return head + `<p class="note">Nothing donated or received yet.</p>`;
  const rank = DATA.members.filter((x) => (x.donations_total || 0) > given).length + 1;
  const ratio = !got ? "hasn't needed any troops yet" : !given ? "hasn't donated yet"
    : given >= got ? `gives ${(given / got).toFixed(1)} troops for every 1 received` : `receives ${(got / given).toFixed(1)} troops for every 1 given`;
  const share = Math.round((given / (given + got)) * 100);
  return head + `<div class="give" role="img" aria-label="Donated ${num(given)}, received ${num(got)}">
      <div class="give-nums"><span><b>${num(given)}</b> donated</span><span><b>${num(got)}</b> received</span></div>
      <div class="give-bar"><span class="given" style="flex-grow:${given}"></span><span class="got" style="flex-grow:${got}"></span></div>
      <p class="note">${share}% given · ${ratio}${given ? ` · ${rank === 1 ? "the" : ordinal(rank)} most donated in the clan` : ""}</p>
    </div>`;
}

// A member's war stats, one scope at a time: tabs for all wars, CWL and regular wars (the choice is
// kept while moving between members).
const WAR_SCOPES = [["all", "All wars"], ["cwl", "CWL"], ["regular", "Regular wars"]];
let warScope = "all";

// Attack and defence ratings (wars.py ratings): points per hit. Attack: each hit's result (stars + destruction)
// against what's expected for the Town Hall gap, 100 for meeting it at TH18; less hitting down or at lower Town Halls (10% less per
// level below 18). A hold scores 100 for a TH18 holding against a TH18, more against stronger attackers and
// at lower Town Halls, where bases are easier to three-star. Shown against the clan: worst red, best green.
const MIN_HITS = 3;
const RANGE_HITS = 1;  // the clan's lowest and highest (bar ends, colours) come from members with this many hits
const RATINGS = {
  attack: ["Attack rating", (s) => s.attack_rating, (s) => s.attacks, "hits"],
  defense: ["Defense rating", (s, d) => d.defense_rating, (s, d) => d.attacked, "times attacked"],
};
function clanRange(scope, which) {
  const [, value, hits] = RATINGS[which];
  const vals = DATA.members.filter((m) => hits(m.war[scope], m.defense[scope]) >= RANGE_HITS)
    .map((m) => value(m.war[scope], m.defense[scope])).filter((v) => typeof v === "number");
  return vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
}
const place = (v, range) => (!range || range.hi <= range.lo ? 0.5 : Math.max(0, Math.min(1, (v - range.lo) / (range.hi - range.lo))));
// Red to amber to green (never the muddy brown a straight red-green blend goes through).
function toneColor(p) {
  return p <= 0.5 ? `color-mix(in srgb, var(--tone-mid) ${Math.round(p * 200)}%, var(--tone-lo))`
    : `color-mix(in srgb, var(--tone-hi) ${Math.round((p - 0.5) * 200)}%, var(--tone-mid))`;
}
function toned(value, range, text) {
  if (!range) return text;
  return `<span class="toned" style="color:${toneColor(place(value, range))}">${text}</span>`;
}
const pts = (v) => num(Math.round(v || 0));

// How a rating adds up (wars.py rating_breakdown): one line per pair of Town Halls, each with an "i" that
// shows the calculation on hover (or tap).
const tip = (text) => `<span class="tip" tabindex="0" role="note" aria-label="${esc(text)}" data-tip="${esc(text)}">i</span>`;
const thGap = (g) => (g === 0 ? "same TH" : `${Math.abs(g)} TH ${g > 0 ? "up" : "down"}`);
// What's par for a hit, in words, by Town Hall gap (wars.py EXPECTED_SCORE).
const PAR = { 0: "a three-star", 1: "a three-star most of the time", 2: "a high 2-star, sometimes a 3", 3: "a high 2-star",
  4: "a 2-star", 5: "a low 2-star", 6: "a 1-star", 7: "a 1-star" };
const par = (gap) => PAR[Math.max(0, Math.min(7, gap))];
const STAR_WORDS = ["zero", "one", "two", "three"];
function results(g) {  // "3 three-stars, 2 two-stars (avg 94%)"
  const parts = [3, 2, 1, 0].filter((s) => g.by_stars?.[s]).map((s) => `${g.by_stars[s]} ${STAR_WORDS[s]}-star${g.by_stars[s] === 1 ? "" : "s"}`);
  return `${parts.join(", ")}${g.by_stars?.[3] === g.hits ? "" : ` <span class="muted">(avg ${g.avg_destruction}%)</span>`}`;
}
const n1 = (x) => (Math.round(x * 10) / 10).toString();
function ratingParts(which, groups, rating) {
  if (!groups?.length) return "";
  const counted = groups.filter((g) => !g.cleanup);
  const hits = counted.reduce((s, g) => s + g.hits, 0);
  const total = counted.reduce((s, g) => s + (which === "attack" ? g.points : g.scored * g.each), 0);
  const lines = groups.map((g) => which === "attack" && g.cleanup
    ? `<li class="muted">TH${g.att_th} on TH${g.def_th} (${thGap(g.gap)}): ${g.hits} hit${g.hits === 1 ? "" : "s"}, clean-up, not counted${
      tip("Hitting 3 or more Town Halls down is cleaning up a bottom base: it doesn't count for or against the attack rating.")}</li>`
    : which === "attack"
    ? `<li>TH${g.att_th} on TH${g.def_th} <span class="muted">(${thGap(g.gap)})</span>: ${g.by_stars ? results(g) : `${g.hits} hit${g.hits === 1 ? "" : "s"}`}. <span class="muted">Par: ${par(g.gap)}.</span> → <b>${n1(g.points)}</b> pts${
      tip(`Hitting at par scores 100 points (on a TH18; 10% less per level below). The maths: each hit's result is its stars plus destruction ÷ 100 (a three-star is 4.0, a 2-star at 95% is 2.95), and par here (${par(g.gap)}) is ${g.expected.toFixed(1)}. Points = result ÷ ${g.expected.toFixed(1)} × 100 × ${g.level} (TH${g.def_th} level)${g.discount < 1 ? ` × ${g.discount} (hitting down)` : ""}. These ${g.hits} hits averaged ${(g.score / g.hits).toFixed(2)}, so ${n1(g.points / g.hits)} each.`)}</li>`
    : `<li>TH${g.att_th} hitting this TH${g.def_th} <span class="muted">(attacker ${thGap(g.gap)})</span>: held ${g.scored} of ${g.hits} × ${n1(g.each)} = <b>${n1(g.scored * g.each)}</b>${
      tip(`One hold here: 100 × ${g.gap_weight} (attacker ${thGap(g.gap)}) × ${g.level} (a TH${g.def_th} base: holds count more at lower Town Halls, at most 3x) = ${n1(g.each)} points. Three-starred hits score 0.`)}</li>`);
  return `<ul class="rating-parts">${lines.join("")}<li class="sum">${n1(total)} points ÷ ${hits} ${which === "attack" ? "hits" : "times attacked"} = <b>${pts(rating)}</b>${
    tip(which === "attack" ? "The rating is the average points per hit. Free hits (on a base already three-starred, in regular wars) aren't counted."
      : "The rating is the average points per hit, with three-starred hits counting 0. Free hits (on a base already three-starred, in regular wars) aren't counted.")}</li></ul>`;
}

// A rating on the clan's scale: a bar from the clan's lowest to highest (everyone with hits), with a
// marker where this member is, and how it adds up.
function ratingBar(m, scope, which) {
  const [label, value, hits, unit] = RATINGS[which];
  const s = m.war[scope], d = m.defense[scope], v = value(s, d), n = hits(s, d), range = clanRange(scope, which);
  if (!n || typeof v !== "number") return "";  // (data from before the ratings existed: nothing, not a 0)
  const few = n < MIN_HITS ? ` <span class="muted">· few ${unit} yet</span>` : "";
  const bar = range ? `<div class="rating-bar"><span class="rating-mark" style="left:${(place(v, range) * 100).toFixed(1)}%"></span></div>
    <div class="rating-ends"><span>${pts(range.lo)} lowest</span><span>highest ${pts(range.hi)}</span></div>` : "";
  return `<div class="rating"><div class="rating-head"><span>${label}</span><b>${toned(v, range, pts(v))}</b>
    <small>${num(n)} ${unit}${few}</small></div>${bar}${ratingParts(which, which === "attack" ? s.breakdown : d.breakdown, v)}</div>`;
}

function warLedger(m, scope) {
  const s = m.war[scope], d = m.defense[scope];
  return ledger([
    [s.attacks ? pct(s.triples / s.attacks) : "–", "3-star rate", "gold"],
    [num(s.attacks), "attacks"],
    [s.avg_stars.toFixed(2), "avg stars"],
    [`${Math.round(s.avg_destruction)}%`, "avg destruction"],
    [num(s.missed), "missed", s.missed ? "loss" : ""],
    d.attacked && [pct(d.held / d.attacked), "defenses held", d.held * 2 >= d.attacked ? "win" : "loss"],
    d.attacked && [num(d.attacked), "times attacked"],
  ]) + (s.attack_rating === undefined ? "" : `<div class="ratings">${ratingBar(m, scope, "attack")}${ratingBar(m, scope, "defense")}</div>
    <p class="note">Ratings are points per hit. Attack: each hit against par for the Town Hall gap (a three-star at the same
    TH, a high 2-star three up, a 1-star six up); hitting at par is 100 at TH18, and clean-ups 3+ TH down don't count. Defense:
    100 is a TH18 holding against a TH18, more against stronger attackers. Lower Town Halls are easier to three-star, so
    there attacks score less and holds more. The bar runs from the clan's lowest to highest.</p>`);
}

function warStats(m) {
  const scopes = WAR_SCOPES.filter(([s]) => m.war[s].wars || m.war[s].attacks || m.defense[s].attacked);
  if (!scopes.length) return "";
  const shown = scopes.some(([s]) => s === warScope) ? warScope : scopes[0][0];
  setTimeout(() => {
    const box = document.getElementById("warstats");
    if (!box) return;
    box.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
      warScope = b.dataset.scope;
      box.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-selected", x === b));
      box.querySelector(".scope-body").innerHTML = warLedger(m, warScope);
    }));
  });
  return `<div id="warstats"><div class="scope-tabs" role="tablist" aria-label="Which wars">${scopes.map(([s, name]) =>
    `<button type="button" role="tab" data-scope="${s}" aria-selected="${s === shown}">${name}</button>`).join("")}</div>
    <div class="scope-body">${warLedger(m, shown)}</div></div>`;
}

// A leader's mark of honour (veterans.py): "Veteran", or "Veteran · <title>", next to the name.
const vetMark = (m) => (m.veteran ? ` <span class="vet">${esc(m.veteran)}</span>` : "");

// What changed in a member's village since the reader's previous visit (reader/compare.py): boxes drawn
// over the screenshot, and one line naming the buildings. Patches the model couldn't name as an upgrade
// count as "other changes" (a troop or hero standing there, a decoration).
const boxPct = (v) => `${(Math.min(1, Math.max(0, +v || 0)) * 100).toFixed(1)}%`;
function baseBoxes(base) {
  if (!base.since || !Array.isArray(base.changes)) return "";
  return base.changes.filter((c) => Array.isArray(c.box) && c.box.length === 4).map((c) => {
    const [x1, y1, x2, y2] = c.box, label = c.building ? `${c.building} ${c.change}` : "changed";
    return `<span class="base-box${c.change === "other" ? " other" : ""}" title="${esc(label)}" style="left:${boxPct(x1)};top:${boxPct(y1)};width:${boxPct(x2 - x1)};height:${boxPct(y2 - y1)}"></span>`;
  }).join("");
}
function baseChanges(base) {
  if (!base.since || !Array.isArray(base.changes)) return "";
  const named = base.changes.filter((c) => c.building && c.change !== "other").map((c) => `${esc(c.building)} ${c.change}`);
  const others = base.changes.length - named.length;
  if (others) named.push(`${others} other change${others === 1 ? "" : "s"}`);
  return `<p class="base-changes">Since ${esc(when(base.since, { month: "short", day: "numeric" }))}: ${named.length ? named.join(" · ") : "no changes spotted"}</p>`;
}

// A member's building upgrades over time, spotted by comparing their base screenshots (reader/compare.py
// on the reader PC, logged by the gate in building_changes). Grouped by the visit that spotted them.
function upgradesPage(tag) {
  const m = MEMBERS.get(tag);
  if (!m) return `<p class="empty">That player isn't in the clan right now.</p>`;
  const ups = m.upgrades || [], day = { month: "short", day: "numeric" };
  const back = `<a class="back" href="#/player/${encodeURIComponent(tag)}">← ${esc(m.name)}</a>`;
  let html = back + `<h2>${esc(m.name)} <small>building upgrades</small></h2>`;
  if (!ups.length) return html + `<p class="empty">No building upgrades spotted yet.</p>`;
  const month = Date.now() / 1000 - 30 * 86400, latest = ups[0].seen;
  html += ledger([
    [num(ups.length), "spotted"],
    [num(ups.filter((u) => u.seen >= month).length), "in the last 30 days"],
    [num(ups.filter((u) => u.seen === latest && u.change === "upgrading").length), "upgrading now"],
  ], "three");
  const visits = new Map();
  for (const u of ups) {
    const key = `${u.seen}/${u.since}`;
    if (!visits.has(key)) visits.set(key, { seen: u.seen, since: u.since, items: [] });
    visits.get(key).items.push(`${esc(u.building)} ${u.change}`);
  }
  html += `<ol class="news upgrades">${[...visits.values()].map((v) => `<li><span class="d">${esc(when(v.seen, day))} <span class="muted">· since ${esc(when(v.since, day))}</span></span>
    <span>${v.items.join(" · ")}</span></li>`).join("")}</ol>
    <p class="note">Compared from screenshots of the base taken about weekly. A building can be missed, or seen twice: upgrading one week,
    upgraded the next. Walls aren't counted.</p>`;
  return html;
}

// What went up, item by item (bot/snapshots.py upgrades): "Barbarian King 95 → 96". Levels from before
// troops and spells were itemized (2026-10-15) show as one count.
function progressItems(p) {
  if (!p || (!p.upgrades?.length && !p.not_itemized)) return "";
  const items = (p.upgrades || []).map((u) => `<li><span>${esc(u.name)}</span> <span class="muted">${u.from ? u.from : "new"} → </span><b>${u.to}</b></li>`);
  if (p.not_itemized) items.push(`<li class="muted">+${num(p.not_itemized)} earlier troop or spell level${p.not_itemized === 1 ? "" : "s"}, from before levels were tracked item by item</li>`);
  return `<ul class="upgrade-list">${items.join("")}</ul>`;
}

function playerPage(tag, sub) {
  if (sub === "upgrades") return upgradesPage(tag);
  const m = MEMBERS.get(tag);
  if (!m) return `<p class="empty">That player isn't in the clan right now.</p>`;
  const since = m.joined ? ` · in the clan since ${when(m.joined, { month: "short", day: "numeric", year: "numeric" })}` : "";
  let html = `<div class="player-head">${th(m.th)}<div><h2>${esc(m.name)}${vetMark(m)}</h2><p>${ROLES[m.role] || ""} · ${esc(m.tag)} · ${m.league_icon ? `<img class="league" src="${esc(m.league_icon)}" alt="${esc(m.league || "")}" title="${esc(m.league || "")}">` : "Unranked"}${since}</p></div></div>`;
  if (ADMIN) html += leaderBox(tag);
  if (m.donations_total != null) html += givePanel(m);
  if (m.base) {
    const seen = when(m.base.taken, { month: "short", day: "numeric", year: "numeric" });
    html += `<h3>Base <small>seen ${esc(seen)}</small></h3>
      <a class="shot base-shot" href="${esc(m.base.src)}" data-src="${esc(m.base.src)}" data-cap="${esc(`${m.name}'s village, ${seen}`)}">
        <img src="${esc(m.base.src.replace(/\.webp$/, "-t.webp"))}" alt="${esc(m.name)}'s village" loading="lazy">${baseBoxes(m.base)}</a>${baseChanges(m.base)}`;
    if (m.upgrades?.length) {
      html += `<p class="base-changes"><a class="link" href="#/player/${encodeURIComponent(tag)}/upgrades">Building upgrades spotted: ${num(m.upgrades.length)} →</a></p>`;
    }
  }
  if (m.progress || m.games) {
    html += `<h3>Progress</h3>` + ledger([
      m.progress && [`+${num(m.progress.gained)}`, `levels upgraded in ${m.progress.days} day${m.progress.days === 1 ? "" : "s"}`, "gold"],
      m.progress && m.progress.days >= 7 && [`${m.progress.per_week}`, "a week at this pace"],
      m.progress && m.progress.th_to > m.progress.th_from && [`TH${m.progress.th_from} → ${m.progress.th_to}`, "town hall"],
      m.games && [num(m.games.points), `Clan Games points${m.games.ongoing ? " so far" : ""}`],
    ]) + progressItems(m.progress) + (m.progress ? `<p class="note">Every hero, troop, spell, siege machine and pet level they upgrade counts as one (hero equipment isn't counted for now),
      from a daily check of their profile. Buildings and walls aren't counted: the game doesn't share them.</p>` : "");
  }
  html += warStats(m);
  const rec = cwlRecord(tag), seasons = rec.rows;
  if (seasons.length) {
    const best = Math.min(...seasons.map((r) => r.position));
    html += `<h2>CWL seasons</h2>` + ledger([
      [`<span class="perfect-n">${num(rec.perfect)}</span>`, "perfect CWLs", "gold"],
      [num(rec.streak), "perfect in a row now"],
      [num(rec.shown), "seasons on the board"],
      [ordinal(best), "best place"],
    ]) + `<p class="note">A perfect CWL is seven attacks, seven three-stars: 21 stars. Older seasons come from leaderboard screenshots, which only show the top of the board.</p>` + table(seasons, [
      { label: "Season", key: (r) => r.s.season, html: (r) => `<a class="link" href="#/cwl/history/${encodeURIComponent(r.s.season)}">${esc(r.s.label)}</a>${r.perfect ? ` ${PERFECT_MARK}` : ""}` },
      { label: "Place", key: (r) => -r.position, html: (r) => `<span class="muted">${ordinal(r.position)}</span>`, num: true },
      { label: "Stars", key: (r) => r.stars, html: (r) => `<b>${r.stars}</b> ${star}`, num: true },
      { label: "Destruction", key: (r) => r.destruction, html: (r) => `${num(r.destruction)}%`, num: true },
      { label: "Attacks", key: (r) => r.attacks, html: (r) => `${r.attacks}/${r.available}`, num: true },
    ], 0);
  }
  if (m.history?.length) html += `<h2>In the clan</h2>` + newsList(m.history.map((e) => ({ ...e, tag })));
  if (m.recent.length) {
    html += `<h2>Recent attacks</h2>` + table(m.recent, [
      { label: "Result", key: null, html: (a) => `${stars(a.stars)} <b>${Math.round(a.pct)}%</b>${a.free ? ` ${FREE_HIT}` : ""}` },
      { label: "Target", key: null, html: (a) => (a.pos ? `<span class="muted">#${a.pos}</span> ${th(a.th, "small")}` : "?") },
      { label: "War", key: null, html: (a) => `<span class="muted">${a.kind === "cwl" ? `CWL round ${a.round}` : "War"} vs</span> ${esc(a.opponent)}` },
      { label: "Date", key: null, html: (a) => `<span class="muted">${when(a.start)}</span>`, num: true },
    ]);
  }
  if (m.recent_defenses?.length) {  // enemy hits on their base: held (not three-starred) in green
    html += `<h2>Recent defenses</h2>` + table(m.recent_defenses, [
      { label: "Result", key: null, html: (d) => `<span class="${d.stars < 3 ? "win" : "loss"}">${stars(d.stars)} <b>${Math.round(d.pct)}%</b> ${d.stars < 3 ? "held" : "three-starred"}</span>${d.free ? ` ${FREE_HIT}` : ""}` },
      { label: "Attacker", key: null, html: (d) => (d.pos ? `<span class="muted">#${d.pos}</span> ${th(d.th, "small")}` : "?") },
      { label: "War", key: null, html: (d) => `<span class="muted">${d.kind === "cwl" ? `CWL round ${d.round}` : "War"} vs</span> ${esc(d.opponent)}` },
      { label: "Date", key: null, html: (d) => `<span class="muted">${when(d.start)}</span>`, num: true },
    ]);
  }
  return html;
}

// ---------------------------------------------------------------- screenshot viewer
// Streak proof opens over the page (a <dialog>): × or Esc or a click outside the picture closes
// it; arrows, arrow keys or a swipe go through that streak's screenshots.
const viewer = { shots: [], i: 0 };

function showShot(i) {
  viewer.i = (i + viewer.shots.length) % viewer.shots.length;
  document.getElementById("viewer-img").src = viewer.shots[viewer.i];
  document.getElementById("viewer-count").textContent = viewer.shots.length > 1 ? `${viewer.i + 1} of ${viewer.shots.length}` : "";
}

function setupViewer() {
  const d = document.getElementById("viewer");
  document.getElementById("page").addEventListener("click", (e) => {
    const a = e.target.closest("a.shot");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;  // ctrl-click still opens a tab
    if (a.dataset.src) {  // one picture (a member's base)
      e.preventDefault();
      viewer.shots = [a.dataset.src];
      document.getElementById("viewer-cap").textContent = a.dataset.cap || "";
      d.classList.add("single");
      showShot(0);
      d.showModal();
      return;
    }
    const s = (DATA.streaks || []).find((x) => x.id === +a.dataset.id);
    if (!s) return;
    e.preventDefault();
    viewer.shots = s.shots;
    document.getElementById("viewer-cap").textContent = `${s.streak}-war win streak of ${s.clan}`;
    d.classList.toggle("single", s.shots.length < 2);
    showShot(+a.dataset.i);
    d.showModal();
  });
  document.getElementById("viewer-close").addEventListener("click", () => d.close());
  document.getElementById("viewer-prev").addEventListener("click", () => showShot(viewer.i - 1));
  document.getElementById("viewer-next").addEventListener("click", () => showShot(viewer.i + 1));
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showShot(viewer.i - 1);
    if (e.key === "ArrowRight") showShot(viewer.i + 1);
  });
  let x0 = null;
  d.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  d.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - (x0 ?? e.changedTouches[0].clientX);
    if (Math.abs(dx) > 50 && viewer.shots.length > 1) showShot(viewer.i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  d.addEventListener("close", () => { document.getElementById("viewer-img").removeAttribute("src"); });
}

// ---------------------------------------------------------------- admin (lovelycoc.com only)
// The admin side runs on the clan's server behind lovelycoc.com/admin/ (admin.py): sign-in with a
// password and an authenticator code, and data that never goes into the public data.json (the chat).
const ADMIN_HOST = "lovelycoc.com";
let ADMIN = null;  // {user} once signed in
let CHAT = null;   // {rows, checked}
let LEADER = null; // bot/leaders.py's report: {housekeeping, log, strikes, seeded}
const chatView = { find: "", who: "" };
const leaderView = { how: "all", kind: "", find: "" };

async function checkAdmin() {
  if (location.hostname !== ADMIN_HOST) return;
  try {
    const r = await fetch("/admin/api/me", { credentials: "same-origin", cache: "no-store" });
    if (r.ok) ADMIN = await r.json();
  } catch (e) { /* not signed in, or the admin side is down: the public site works the same */ }
}

// The admin's own pages: first sign-in (choose a password, add the authenticator), the owner's
// user list, and changing a password. All talk to admin.py on this origin.
// The Admin tab: signed out, the sign-in form; signed in, a sub-menu over everything admins see.
const ADMIN_PAGES = [["", "Housekeeping"], ["log", "Member log"], ["strikes", "Strikes"], ["veterans", "Veterans"],
  ["chat", "Chat log"], ["visits", "Visitors"], ["users", "Users", "owner"], ["password", "Password"]];

function adminNav(sub) {
  const items = ADMIN.setup ? [] : ADMIN_PAGES.filter(([, , only]) => !only || ADMIN.role === only);
  return `<div class="subnav admin-nav">${items.map(([k, v]) => `<a href="#/admin${k ? `/${k}` : ""}" class="${(sub || "") === k ? "on" : ""}">${v}</a>`).join("")}
    <span class="who">${esc(ADMIN.user)} · <button type="button" id="signout">Sign out</button></span></div>`;
}

function adminSub(sub) {
  if (!ADMIN) return adminPage();
  if (ADMIN.setup || sub === "setup") return adminNav("setup") + setupPage();
  const page = { log: () => leadersPage("log"), strikes: () => leadersPage("strikes"), veterans: () => leadersPage("veterans"),
    chat: chatPage, visits: visitsPage, users: usersPage, password: passwordPage }[sub] || (() => leadersPage(""));
  return adminNav(sub) + page();
}

function formPost(form, path, body, onOk) {
  const msg = form.querySelector(".msg"), button = form.querySelector("button[type=submit]");
  button.disabled = true;
  msg.textContent = "Checking…";
  adminPost(path, body).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (r.ok) return onOk(data);
    msg.textContent = data.error || "That didn't work.";
    button.disabled = false;
  }).catch(() => { msg.textContent = "Couldn't reach the server."; button.disabled = false; });
}

function setupPage() {
  if (!ADMIN) return `<p class="empty">Sign in first (<a class="link" href="#/admin">admin</a>).</p>`;
  if (!ADMIN.setup) { setTimeout(() => { location.hash = "#/admin"; }); return ""; }
  setTimeout(async () => {
    const box = document.getElementById("setup-key");
    if (!box) return;
    try {
      const r = await fetch("/admin/api/setup", { credentials: "same-origin", cache: "no-store" });
      const data = await r.json();
      if (!r.ok) { box.textContent = data.error || "Couldn't get the key."; return; }
      box.innerHTML = `<b class="key">${esc(data.key)}</b>
        <span class="note">On a phone, <a class="link" href="${esc(data.uri)}">open it in the authenticator app</a> instead of typing.</span>`;
    } catch (e) { box.textContent = "Couldn't reach the server."; }
    const form = document.getElementById("setup");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (form.password.value !== form.password2.value) { form.querySelector(".msg").textContent = "The two passwords don't match."; return; }
      formPost(form, "/admin/api/setup", { password: form.password.value, code: form.code.value },
        () => { location.hash = "#/admin"; location.reload(); });
    });
  });
  return `<h2>Welcome, ${esc(ADMIN.user)} <small>first sign-in</small></h2>
    <p class="note">Two things before you can see anything: choose a password, and add this site to an authenticator app
      (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). In the app: add an account, enter a setup key,
      time based. Then type the 6-digit code it shows.</p>
    <p class="aside" id="setup-key">Getting your key…</p>
    <form id="setup" class="signin" autocomplete="on">
      <label>New password (16 characters or more; a few words is easiest) <input name="password" type="password" autocomplete="new-password" required minlength="16" maxlength="200"></label>
      <label>The same password again <input name="password2" type="password" autocomplete="new-password" required minlength="16" maxlength="200"></label>
      <label>The 6-digit code from the app <input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" required maxlength="7"></label>
      <button type="submit" class="join">Finish</button>
      <p class="note msg" role="status"></p>
    </form>`;
}

function passwordPage() {
  if (!ADMIN || ADMIN.setup) return `<p class="empty">Sign in first (<a class="link" href="#/admin">admin</a>).</p>`;
  setTimeout(() => {
    const form = document.getElementById("password-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (form.new_password.value !== form.new_password2.value) { form.querySelector(".msg").textContent = "The two new passwords don't match."; return; }
      formPost(form, "/admin/api/password", { password: form.password.value, new_password: form.new_password.value, code: form.code.value },
        () => { form.querySelector(".msg").textContent = "Changed. Your other devices are signed out."; form.reset(); form.querySelector("button[type=submit]").disabled = false; });
    });
  });
  return `<h2>Change your password</h2>
    <form id="password-form" class="signin" autocomplete="on">
      <label>Current password <input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
      <label>New password (16 characters or more) <input name="new_password" type="password" autocomplete="new-password" required minlength="16" maxlength="200"></label>
      <label>The new password again <input name="new_password2" type="password" autocomplete="new-password" required minlength="16" maxlength="200"></label>
      <label>The 6-digit code from your authenticator app <input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" required maxlength="7"></label>
      <button type="submit" class="join">Change</button>
      <p class="note msg" role="status"></p>
    </form>`;
}

let USERS = null;

function usersPage() {
  if (!ADMIN || ADMIN.setup) return `<p class="empty">Sign in first (<a class="link" href="#/admin">admin</a>).</p>`;
  if (ADMIN.role !== "owner") return `<p class="empty">Only the owner manages users.</p>`;
  setTimeout(async () => {
    const list = document.getElementById("users"), form = document.getElementById("adduser"), shown = document.getElementById("temp");
    if (!list) return;
    const draw = async () => {
      try {
        const r = await fetch("/admin/api/users", { credentials: "same-origin", cache: "no-store" });
        USERS = r.ok ? (await r.json()).users : [];
      } catch (e) { USERS = []; }
      list.innerHTML = `<div class="sheet"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${USERS.map((u) => `
        <tr><td>${esc(u.username)}</td><td class="muted">${esc(u.role)}</td>
        <td>${!u.setup ? "ready" : u.invite_expires > Date.now() / 1000 ? `<span class="gold">invited · ${until(u.invite_expires)} left</span>`
          : `<span class="loss">invite ran out · reset for a new password</span>`}</td>
        <td class="muted">${u.last_login ? ago(u.last_login) : "never"}</td>
        <td class="num">${u.role === "owner" ? "" : `<button type="button" class="mode" data-reset="${esc(u.username)}">reset</button> · <button type="button" class="mode" data-remove="${esc(u.username)}">remove</button>`}</td></tr>`).join("")}</tbody></table></div>`;
      list.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Give ${b.dataset.reset} a new temporary password? Their authenticator entry stops working and they set up again.`)) return;
        const r = await adminPost("/admin/api/users/reset", { username: b.dataset.reset });
        const data = await r.json().catch(() => ({}));
        show(r.ok ? temp(data) : `<span class="loss">${esc(data.error || "That didn't work.")}</span>`);
        draw();
      }));
      list.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Remove ${b.dataset.remove}? They're signed out everywhere.`)) return;
        const r = await adminPost("/admin/api/users/remove", { username: b.dataset.remove });
        const data = await r.json().catch(() => ({}));
        show(r.ok ? "" : `<span class="loss">${esc(data.error || "That didn't work.")}</span>`);
        draw();
      }));
    };
    // The temporary password, shown once, as a message ready to send privately (with a Copy button).
    const show = (html) => {
      shown.innerHTML = html;
      shown.hidden = !html;
      const copy = shown.querySelector("#copy-invite");
      if (copy) copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(document.getElementById("invite-text").textContent); copy.textContent = "Copied"; }
        catch (e) { copy.textContent = "Select the text and copy it"; }
      });
      if (html) shown.scrollIntoView({ block: "nearest" });
    };
    const temp = (data) => `Send this to <b>${esc(data.username)}</b> in a private message. It's shown only now; if it gets lost, reset them for a new one.
      <pre class="invite" id="invite-text">Admin sign-in for the Lovely clan site
Username: ${esc(data.username)}
Temporary password: ${esc(data.temporary_password)}
Sign in at https://${ADMIN_HOST}/#/admin within 24 hours; after that this password stops working. Leave the code box empty, then choose your own password and add an authenticator app.</pre>
      <button type="button" class="join" id="copy-invite">Copy</button>`;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      formPost(form, "/admin/api/users/add", { username: form.username.value }, (data) => {
        show(temp(data));
        form.reset();
        form.querySelector("button[type=submit]").disabled = false;
        form.querySelector(".msg").textContent = "";
        draw();
      });
    });
    draw();
  });
  return `<h2>Users</h2>
    <p class="note">Everyone here sees the leaders' pages and the chat log. Adding someone makes a temporary password that works for 24 hours;
      they sign in with it, choose their own password and add an authenticator before they see anything. If it runs out, reset them for a new one.</p>
    <div id="users"><p class="empty">Loading…</p></div>
    <h3>Add a user</h3>
    <form id="adduser" class="signin" autocomplete="off">
      <label>Username (letters, digits, dots, dashes) <input name="username" required pattern="[a-z0-9][a-z0-9._-]{1,31}" maxlength="32" autocapitalize="none" spellcheck="false"></label>
      <button type="submit" class="join">Add</button>
      <p class="note msg" role="status"></p>
    </form>
    <p class="aside" id="temp" hidden></p>`;
}


// Signed out, a faint way in; signed in, everything is under the Admin tab.
function adminFooter() {
  if (ADMIN) return "";
  const here = location.hostname === ADMIN_HOST;
  return `<p class="admin"><a href="${here ? "" : `https://${ADMIN_HOST}/`}#/admin" rel="nofollow">admin</a></p>`;
}

const adminPost = (path, body) => fetch(path, {
  method: "POST", credentials: "same-origin", cache: "no-store",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function setupAdmin() {
  document.getElementById("page").addEventListener("click", async (e) => {  // the Admin tab's sign-out
    if (!e.target.closest("#signout")) return;
    try { await adminPost("/admin/api/logout", {}); } catch (err) { /* offline */ }
    location.href = "/";
  });
}

// The sign-in form: username, password and the 6-digit code from the authenticator app.
function adminPage() {
  if (location.hostname !== ADMIN_HOST) return `<p class="empty">Sign in on <a class="link" href="https://${ADMIN_HOST}/#/admin">${ADMIN_HOST}</a>.</p>`;
  if (ADMIN) { setTimeout(() => { location.hash = ADMIN.setup ? "#/admin/setup" : "#/admin"; }); return ""; }
  setTimeout(() => {
    const form = document.getElementById("signin");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("signin-msg"), button = form.querySelector("button");
      button.disabled = true;
      msg.textContent = "Checking…";
      try {
        const r = await adminPost("/admin/api/login", {
          username: form.username.value, password: form.password.value, code: form.code.value,
        });
        if (r.ok) {
          location.hash = (await r.json().catch(() => ({}))).setup ? "#/admin/setup" : "#/admin";
          location.reload();
          return;
        }
        msg.textContent = (await r.json().catch(() => ({}))).error || "Couldn't sign in.";
      } catch (err) {
        msg.textContent = "Couldn't reach the server.";
      }
      form.code.value = "";
      button.disabled = false;
    });
  });
  return `<h2>Admin</h2>
    <form id="signin" class="signin" autocomplete="on">
      <label>Username <input name="username" autocomplete="username" required maxlength="64" autocapitalize="none" spellcheck="false"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
      <label>Code from your authenticator app <input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7"></label>
      <p class="note">First time? Use the temporary password you were sent and leave the code empty.</p>
      <button type="submit" class="join">Sign in</button>
      <p class="note" id="signin-msg" role="status"></p>
    </form>`;
}

async function loadChat() {
  try {
    const r = await fetch("/admin/api/chat", { credentials: "same-origin", cache: "no-store" });
    CHAT = r.ok ? await r.json() : { rows: [], error: r.status === 401 ? "Your sign-in ran out. Sign in again from the admin link." : "Couldn't load the chat." };
    if (r.status === 401) ADMIN = null;
  } catch (e) {
    CHAT = { rows: [], error: "Couldn't load the chat." };
  }
  if (location.hash.startsWith("#/admin/chat")) route();
}

async function loadLeader() {
  if (loadLeader.busy) return;
  loadLeader.busy = true;
  try {
    const r = await fetch("/admin/api/leader", { credentials: "same-origin", cache: "no-store" });
    LEADER = r.ok ? await r.json() : { error: r.status === 401 ? "Your sign-in ran out. Sign in again from the admin link." : "Couldn't load the leaders' data." };
    if (r.status === 401) ADMIN = null;
  } catch (e) {
    LEADER = { error: "Couldn't load the leaders' data." };
  }
  loadLeader.busy = false;
  if (/^#\/(admin|player)\b/.test(location.hash)) route();
}

// Veterans are out of every filter but their own (bot/leaders.py keep()).
const HK_FILTERS = {
  all: ["Everyone, most in need of a look first", (r) => !r.veteran], quiet: ["Quiet for 7+ days", (r) => !r.veteran && r.quiet >= 7],
  out: ["War preference: out", (r) => !r.veteran && r.war === "out"], missed: ["Missed attacks lately", (r) => !r.veteran && r.missed > 0],
  strikes: ["Has strikes (30 days)", (r) => !r.veteran && r.strikes > 0], new: ["Joined in the last 14 days", (r) => !r.veteran && r.new],
  veterans: ["Veterans (not listed elsewhere)", (r) => !!r.veteran],
};
const LOG_KINDS = {
  "": ["Everything", () => true], members: ["Joins and leaves", (e) => ["join", "rejoin", "leave"].includes(e.kind)],
  roles: ["Promotions, demotions, veterans", (e) => ["promote", "demote", "veteran", "unveteran"].includes(e.kind)],
  upgrades: ["Upgrades, milestones, renames", (e) => ["th", "milestone", "rename"].includes(e.kind)],
  warned: ["Warnings", (e) => e.kind === "warned"],
};
// "Last played" in plain words. Without any sign of play since the bot started watching (or since they
// joined), the days are a floor: "N+ days ago".
const played = (r) => {
  const d = Math.round(r.quiet), days = (n, plus = "") => `${n}${plus} day${n === 1 ? "" : "s"} ago`;
  if (r.seen) return r.quiet < 1 ? "today" : days(d);
  return `<span title="No play seen since the bot started watching">${days(Math.max(1, d), "+")}</span>`;
};

// Leaders only (admin.py, never data.json): housekeeping, the full member log and strikes.
function leadersPage(sub) {
  if (!ADMIN) return `<p class="empty">Sign in (<a class="link" href="#/admin">admin</a>) to see this.</p>`;
  if (!LEADER) { loadLeader(); return `<p class="empty">Loading…</p>`; }
  if (LEADER.error) return `<p class="empty">${esc(LEADER.error)}</p>`;
  return sub === "log" ? memberLogPage() : sub === "strikes" ? strikesPage() : sub === "veterans" ? veteransPage() : housekeepingPage();
}

// Veterans (veterans.py): who they are, and making or unmaking one. The Discord role, if one is set,
// follows within the hour (the site can't touch Discord).
async function veteranPost(path, body) {
  const r = await adminPost(path, body);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { alert(data.error || "That didn't work."); return false; }
  LEADER = null;
  loadLeader();
  return true;
}

function veteransPage() {
  const vets = LEADER.veterans || [], here = vets.filter((v) => v.in_clan);
  const taken = new Set(vets.map((v) => v.tag));
  const pick = [...MEMBERS.values()].filter((m) => !taken.has(m.tag)).sort((a, b) => a.name.localeCompare(b.name));
  setTimeout(() => {
    const form = document.getElementById("addvet");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tag = form.elements.tag.value, title = form.elements.title.value;
      if (!tag) return;
      form.querySelector("button[type=submit]").disabled = true;
      if (!(await veteranPost("/admin/api/veterans/add", { tag, title }))) form.querySelector("button[type=submit]").disabled = false;
    });
    document.querySelectorAll("[data-unvet]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Take ${b.dataset.name}'s veteran mark back?`)) return;
      await veteranPost("/admin/api/veterans/remove", { tag: b.dataset.unvet });
    }));
  });
  let html = `<h2>Veterans <small>${num(here.length)} in the clan · admins only</small></h2>`;
  html += vets.length ? table(vets, [
    { label: "Member", key: (v) => v.name.toLowerCase(), html: (v) => `${who(v.tag, v.name)}${v.in_clan ? "" : ` <span class="muted">(left)</span>`}` },
    { label: "Title", key: (v) => v.title, html: (v) => (v.title ? esc(v.title) : `<span class="muted">–</span>`) },
    { label: "Since", key: (v) => v.since, html: (v) => when(v.since, { month: "short", day: "numeric", year: "numeric" }) },
    { label: "By", key: (v) => v.by, html: (v) => `<span class="muted">${esc(v.by)}</span>` },
    { label: "", key: () => 0, html: (v) => `<button type="button" class="mode" data-unvet="${esc(v.tag)}" data-name="${esc(v.name)}">remove</button>`, num: true },
  ], "since", 1) : `<p class="empty">No veterans yet.</p>`;
  html += `<form id="addvet" class="controls"><select name="tag" aria-label="Member"><option value="">Make a veteran…</option>${pick.map((m) =>
    `<option value="${esc(m.tag)}">${esc(m.name)}</option>`).join("")}</select>
    <input name="title" type="text" maxlength="${LEADER.veteran_title_max || 40}" placeholder="Title (optional), e.g. Founding member">
    <button type="submit" class="mode">Add</button></form>
    <p class="note">A veteran gets the mark next to their name on the site and in the bot, and stays out of housekeeping's lists
    (there's a Veterans filter). Becoming one is posted as clan news. A veteran who leaves keeps the mark for if they come back;
    it's hidden meanwhile. In Discord: <b>/veteran</b>, and <b>/veteranrole</b> for a role.</p>`;
  return html;
}

function housekeepingPage() {
  const rows = LEADER.housekeeping, count = (f) => rows.filter(HK_FILTERS[f][1]).length;
  const since = LEADER.seeded ? when(LEADER.seeded, { month: "short", day: "numeric" }) : "the start";
  setTimeout(() => {
    const pick = document.getElementById("hkhow");
    if (!pick) return;
    pick.value = leaderView.how;
    pick.addEventListener("change", () => { leaderView.how = pick.value; document.getElementById("hk").innerHTML = hkTable(); });
  });
  return `<h2>Housekeeping <small>${num(rows.length)} members · admins only</small></h2>` + ledger([
    [num(count("quiet")), "quiet 7+ days", count("quiet") ? "loss" : ""],
    [num(count("out")), "war preference out"],
    [num(count("missed")), "missed attacks lately", count("missed") ? "loss" : ""],
    [num(count("strikes")), "with strikes (30 days)"],
    [num(count("new")), "joined in 14 days"],
    count("veterans") && [num(count("veterans")), "veterans not listed"],
  ]) + `<div class="controls"><select id="hkhow" aria-label="Show">${Object.entries(HK_FILTERS).map(([k, [v]]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
    <div id="hk">${hkTable()}</div>
    <p class="note">Last played is worked out from the API (donations, XP, war attacks, builder base), since the game has no "last online"; it's only kept for current members.
    Missed counts the clan's last 10 wars. Donated and war preference come from the daily profile check. Time in the clan counts from ${esc(since)} for anyone already here then.
    Give a warning with <b>/housekeeping</b> in Discord.</p>`;
}

function hkTable() {
  const rows = LEADER.housekeeping.filter(HK_FILTERS[leaderView.how][1]);
  if (!rows.length) return `<p class="empty">Nobody.</p>`;
  return table(rows, [
    { label: "Member", key: (r) => r.name.toLowerCase(), html: (r) => `${th(r.th, "small")} ${who(r.tag, r.name)} <span class="role ${esc(r.role)}">${ROLES[r.role] || ""}</span>${vetMark(r)}` },
    { label: "Last played", key: (r) => -r.quiet, html: (r) => `<span class="${r.quiet >= 7 ? "loss" : r.seen ? "" : "muted"}">${played(r)}</span>` },
    { label: "War", key: (r) => (r.war === "out" ? 0 : 1), html: (r) => (r.war === "out" ? `<span class="loss">out</span>` : r.war ? "in" : `<span class="muted">–</span>`) },
    { label: "Missed", key: (r) => r.missed, html: (r) => (r.wars ? `<span class="${r.missed ? "loss" : "muted"}">${r.missed}/${r.wars}</span>` : `<span class="muted">–</span>`), num: true },
    { label: "Strikes", key: (r) => r.strikes, html: (r) => (r.strikes ? `<b class="loss">${r.strikes}</b>` : `<span class="muted">0</span>`), num: true },
    { label: "Donated 30d", key: (r) => r.donated ?? -1, html: (r) => (r.donated == null ? `<span class="muted">–</span>` : num(r.donated)), num: true },
    { label: "In clan", key: (r) => r.days_in, html: (r) => (r.new ? `<span class="gold">new</span>` : `${Math.round(r.days_in)}d`), num: true },
  ], null);  // already in "needs a look" order
}

function memberLogPage() {
  setTimeout(() => {
    const kind = document.getElementById("logkind"), find = document.getElementById("logfind");
    if (!kind) return;
    kind.value = leaderView.kind;
    find.value = leaderView.find;
    const redraw = () => { leaderView.kind = kind.value; leaderView.find = find.value; document.getElementById("log").innerHTML = logList(); };
    kind.addEventListener("change", redraw);
    find.addEventListener("input", redraw);
  });
  return `<h2>Member log <small>everything, with who did it</small></h2>
    <div class="controls"><select id="logkind" aria-label="Kind">${Object.entries(LOG_KINDS).map(([k, [v]]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
      <input id="logfind" type="search" placeholder="Find a member" aria-label="Find a member" autocomplete="off"></div>
    <div id="log">${logList()}</div>
    <p class="note">From the member list the bot reads every 5 minutes. Who accepted, kicked or promoted someone comes from the clan chat, a few hours later.</p>`;
}

function logList() {
  const needle = leaderView.find.trim().toLowerCase();
  return newsList(LEADER.log.filter((e) => LOG_KINDS[leaderView.kind][1](e) && (!needle || `${e.name} ${e.old || ""}`.toLowerCase().includes(needle))), true);
}

function strikeTable(rows) {
  return table(rows, [
    { label: "#", key: (s) => s.id, html: (s) => `<span class="muted">${s.id}</span>` },
    { label: "Date", key: (s) => s.ts, html: (s) => `<span class="muted">${when(s.ts)}</span>` },
    { label: "Member", key: (s) => (s.name || "").toLowerCase(), html: (s) => who(s.tag, s.name || s.tag) },
    { label: "Reason", key: null, html: (s) => esc(s.reason), wrap: true },
    { label: "By", key: (s) => s.by, html: (s) => `<span class="muted">${s.by === "bot" ? "the bot" : esc(s.by)}</span>` },
  ], 1);
}

function strikesPage() {
  const recent = LEADER.strikes.filter((s) => s.ts > Date.now() / 1000 - LEADER.strike_window_days * 86400);
  if (!LEADER.strikes.length) return `<h2>Strikes</h2><p class="empty">No strikes yet.</p>`;
  return `<h2>Strikes</h2>` + ledger([
    [num(recent.length), `strikes in ${LEADER.strike_window_days} days`, recent.length ? "loss" : ""],
    [num(new Set(recent.map((s) => s.tag)).size), "members with one"],
    [num(LEADER.strikes.length), "all time"],
  ]) + strikeTable(LEADER.strikes) + `<p class="note">Missed attacks become strikes when a war ends. Give or take back strikes with <b>/strikes</b> in Discord.</p>`;
}

// A member's leaders-only notes, at the top of their page.
function leaderBox(tag) {
  if (!LEADER) { loadLeader(); return `<p class="note">Loading the leaders' notes…</p>`; }
  if (LEADER.error) return `<p class="note">${esc(LEADER.error)}</p>`;
  const r = LEADER.housekeeping.find((x) => x.tag === tag);
  // The log here is what the public page doesn't show: leaves, demotions, warnings, and who did it.
  const strikes = LEADER.strikes.filter((s) => s.tag === tag);
  const log = LEADER.log.filter((e) => e.tag === tag && (e.by || !["join", "rejoin", "promote", "th", "rename", "milestone"].includes(e.kind)));
  let html = `<section class="leaders-only"><h3>Leaders only</h3>`;
  if (r) {
    html += ledger([
      [played(r), "last played", r.quiet >= 7 ? "loss" : ""],
      [r.war ? (r.war === "out" ? "Out" : "In") : "–", "war preference", r.war === "out" ? "loss" : ""],
      [r.wars ? `${r.missed}/${r.wars}` : "–", "missed, last 10 wars", r.missed ? "loss" : ""],
      [num(r.strikes), "strikes, 30 days", r.strikes ? "loss" : ""],
      [r.donated == null ? "–" : num(r.donated), "donated, 30 days"],
    ]);
  }
  if (strikes.length) html += `<h3>Strikes</h3>` + strikeTable(strikes);
  if (log.length) html += `<h3>Member log</h3>` + newsList(log, true);
  // Veteran: one click to make or unmake (a title is asked for when making).
  const v = (LEADER.veterans || []).find((x) => x.tag === tag);
  setTimeout(() => {
    const b = document.getElementById("vetbtn");
    if (!b) return;
    b.addEventListener("click", async () => {
      if (v) {
        if (confirm(`Take ${b.dataset.name}'s veteran mark back?`)) await veteranPost("/admin/api/veterans/remove", { tag });
      } else {
        const title = prompt("A title to show with the mark (optional), e.g. Founding member", "");
        if (title !== null) await veteranPost("/admin/api/veterans/add", { tag, title });
      }
    });
  });
  const m = MEMBERS.get(tag);
  html += `<p class="note">${v ? `Clan veteran since ${esc(when(v.since, { month: "short", day: "numeric", year: "numeric" }))} (by ${esc(v.by)}). ` : ""}<button type="button" class="mode" id="vetbtn" data-name="${esc(m ? m.name : "")}">${v ? "Remove veteran" : "Make a veteran"}</button></p>`;
  return html + `</section>`;
}

// The game reader on the PC (admin.py /admin/api/reader): is it on, what's it doing, and a button to
// run it now. While a run is asked for or going, it checks every few seconds; when a new run finishes,
// the chat reloads.
let READER = null;
const readerWatch = { timer: null, after: null };

async function loadReader() {
  try {
    const r = await fetch("/admin/api/reader", { credentials: "same-origin", cache: "no-store" });
    READER = r.ok ? await r.json() : { error: r.status === 401 ? "Your sign-in ran out." : "Couldn't reach the reader's status." };
  } catch (e) {
    READER = { error: "Couldn't reach the reader's status." };
  }
  if (readerWatch.after !== null && READER.last && READER.last.id > readerWatch.after && READER.last.status !== "running") {
    readerWatch.after = null;  // the run we asked for has finished: show the new chat
    CHAT = null;
  }
  const box = document.getElementById("reader");
  if (box) box.innerHTML = readerPanel();
  else if (!location.hash.startsWith("#/admin/chat")) { clearInterval(readerWatch.timer); readerWatch.timer = null; return; }
  if (CHAT === null && location.hash.startsWith("#/admin/chat")) loadChat();
  const busy = READER.pending || (READER.state || "").startsWith("reading") || readerWatch.after !== null;
  if (busy && !readerWatch.timer) readerWatch.timer = setInterval(loadReader, 5000);
  if (!busy && readerWatch.timer) { clearInterval(readerWatch.timer); readerWatch.timer = null; }
}

function readerPanel() {
  if (!READER) return `<p class="note">Checking the reader…</p>`;
  if (READER.error) return `<p class="note">${esc(READER.error)}</p>`;
  const r = READER, reading = (r.state || "").startsWith("reading");
  const now = r.pending ? "asked for a run; the PC picks it up within a minute"
    : !r.online ? `the PC is off${r.seen ? ` (last seen ${ago(r.seen)})` : ""}` : esc(r.state);
  const last = r.last ? `Last run ${ago(r.last.finished || r.last.started)}: ${esc(r.last.summary)}.` : "No runs yet.";
  const can = r.online && !r.pending && !reading;
  return `<div class="reader-line"><span class="dot ${r.online ? "on" : ""}"></span>
      <span><b>Game reader</b> · ${now}<br><span class="muted">${last}</span></span>
      <button type="button" class="join" id="run-reader" ${can ? "" : "disabled"}>${reading || r.pending ? "Running…" : "Run the reader now"}</button></div>
    <p class="note" id="reader-msg" role="status"></p>`;
}

async function runReader() {
  const button = document.getElementById("run-reader"), msg = document.getElementById("reader-msg");
  if (button) button.disabled = true;
  try {
    const before = READER?.last?.id ?? 0;
    const r = await adminPost("/admin/api/reader/run", {});
    const data = await r.json().catch(() => ({}));
    if (r.ok) { READER = data; readerWatch.after = before; }
    if (msg) msg.textContent = data.message || data.error || "That didn't work.";
  } catch (e) {
    if (msg) msg.textContent = "Couldn't reach the server.";
  }
  const keep = document.getElementById("reader-msg")?.textContent;
  await loadReader();
  const m = document.getElementById("reader-msg");
  if (m && keep) m.textContent = keep;
}

// Visitors (admin.py /admin/api/visits): the last 30 days of anonymous visit counts.
let VISITS = null;
const PAGE_NAMES = { overview: "Overview", news: "Clan news", members: "Members", player: "Player pages", war: "War",
  cwl: "CWL", streaks: "Streaks", leaderboards: "Leaderboards" };

async function loadVisits() {
  try {
    const r = await fetch("/admin/api/visits", { credentials: "same-origin", cache: "no-store" });
    VISITS = r.ok ? { ...(await r.json()), at: Date.now() } : { error: r.status === 401 ? "Your sign-in ran out." : "Couldn't load the visits.", at: Date.now() };
  } catch (e) {
    VISITS = { error: "Couldn't load the visits.", at: Date.now() };
  }
  if (location.hash.startsWith("#/admin/visits")) route();
}

function visitsPage() {
  if (!VISITS || Date.now() - VISITS.at > 60000) { loadVisits(); if (!VISITS) return `<p class="empty">Loading…</p>`; }
  if (VISITS.error) return `<p class="empty">${esc(VISITS.error)}</p>`;
  const v = VISITS, top = Math.max(1, ...v.daily.map((d) => d.visitors));
  const day = (iso, opts = { month: "short", day: "numeric" }) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
  const bars = v.daily.map((d, i) => `<span class="${i === v.daily.length - 1 ? "today" : ""}" style="height:${Math.round((d.visitors / top) * 100)}%"
    title="${day(d.day, { weekday: "short", month: "short", day: "numeric" })}: ${d.visitors} visitor${d.visitors === 1 ? "" : "s"}, ${d.visits} visits, ${d.views} tab views"></span>`).join("");
  const list = (rows, label, value) => (rows.length ? `<ol class="ranks">${rows.map((r, i) => `<li><span class="rank ${i ? "" : "r1"}">${i + 1}</span>
      <span class="who">${label(r)}</span><b class="value ${i ? "" : "gold"}">${num(value(r))}</b></li>`).join("")}</ol>` : `<p class="empty">Nothing yet.</p>`);
  return `<h2>Visitors <small>${v.since ? `counting since ${day(v.since)}` : "nothing counted yet"} · admins only</small></h2>` + ledger([
    [num(v.today.visitors), "visitors today", "gold"],
    [num(v.today.visits), "visits today"],
    [num(v.week.visitors), "visitors, 7 days"],
    [num(v.month.visitors), "visitors, 30 days"],
    [num(v.month.views), "tab views, 30 days"],
  ]) + `<h3>Visitors a day, last 30 days</h3><div class="bars" role="img" aria-label="Visitors a day">${bars}</div>
    <div class="bars-axis"><span>${day(v.daily[0].day)}</span><span>today</span></div>
    <div class="cols">
      <section><h2>Most viewed</h2>${list(v.pages, (r) => esc(PAGE_NAMES[r.page] || r.page), (r) => r.views)}</section>
      <section><h2>Where visits came from</h2>${list(v.referrers, (r) => esc(r.host), (r) => r.visits)}
        <p class="note">Visits typed in or opened from an app often don't say where they came from, so they aren't listed.</p></section>
    </div>
    <p class="note">Counted on lovelycoc.com and turtscocclan.com, without keeping anyone's IP address: a visitor is a scrambled code
    that changes every day, so someone who visits on three days counts as three, and nobody can be traced back. Signed-in admins aren't counted.
    Visits straight to turtdle.github.io aren't counted.</p>`;
}

// The recorded clan chat in order, like the game (newest at the bottom, where it opens); runs of messages under their speaker.
function chatPage() {
  if (!ADMIN) return `<p class="empty">Sign in (<a class="link" href="#/admin">admin</a>) to see the clan chat.</p>`;
  if (!CHAT) { loadChat(); return `<p class="empty">Loading the clan chat…</p>`; }
  if (CHAT.error) return `<p class="empty">${esc(CHAT.error)}</p>`;
  setTimeout(() => {
    loadReader();
    const reader = document.getElementById("reader");
    if (reader) reader.addEventListener("click", (e) => { if (e.target.closest("#run-reader")) runReader(); });
    const find = document.getElementById("chatfind"), who = document.getElementById("chatwho");
    if (!find) return;
    find.value = chatView.find;
    who.value = chatView.who;
    // Like the game: oldest at the top, newest at the bottom, opened at the newest.
    const log = document.getElementById("chatlog"), toNewest = () => { log.scrollTop = log.scrollHeight; };
    toNewest();
    const redraw = () => { chatView.find = find.value; chatView.who = who.value; log.innerHTML = chatLog(); toNewest(); };
    find.addEventListener("input", redraw);
    who.addEventListener("change", redraw);
  });
  const counts = {};
  CHAT.rows.forEach((r) => { if (r.author && r.kind !== "system") counts[r.author] = (counts[r.author] || 0) + 1; });
  const people = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return `<h2>Clan chat <small>${num(CHAT.rows.length)} messages${CHAT.checked ? ` · checked ${ago(CHAT.checked)}` : ""} · admins only</small></h2>
    <div id="reader" class="reader">${readerPanel()}</div>
    <div class="controls"><input id="chatfind" type="search" placeholder="Find in the chat" aria-label="Find in the chat" autocomplete="off">
      <select id="chatwho" aria-label="Member"><option value="">Everyone</option>${people.map((p) => `<option value="${esc(p)}">${esc(p)} (${counts[p]})</option>`).join("")}</select></div>
    <div id="chatlog" class="chat">${chatLog()}</div>
    <p class="note">Newest at the bottom, like in the game. Times are approximate (the game only says "3h ago"). Read from the game by the clan bot's reader.</p>`;
}

function chatLog() {
  const needle = chatView.find.trim().toLowerCase();
  const thByName = new Map(DATA.members.map((m) => [m.name, m.th]));
  const rows = CHAT.rows.filter((r) => (!chatView.who || r.author === chatView.who) && (!needle || r.text.toLowerCase().includes(needle)));
  if (!rows.length) return `<p class="empty">Nothing${needle ? ` with “${esc(chatView.find.trim())}”` : ""}.</p>`;
  const days = [];
  for (const r of rows) {
    const day = new Date(r.ts * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  const time = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const mark = (text) => {  // highlight what was searched for, escaping each piece separately
    if (!needle) return esc(text);
    const lower = text.toLowerCase();
    let out = "", i = 0, j;
    while ((j = lower.indexOf(needle, i)) !== -1) {
      out += esc(text.slice(i, j)) + `<mark>${esc(text.slice(j, j + needle.length))}</mark>`;
      i = j + needle.length;
    }
    return out + esc(text.slice(i));
  };
  return days.map(({ day, rows: list }) => {
    let html = `<h3>${esc(day)}</h3>`, speaker = null;
    for (const r of list) {
      if (r.kind === "system" || r.kind === "donation_request") {
        speaker = null;
        const text = r.kind === "system" ? r.text : `${r.author || "?"} asked for ${r.text}`;
        html += `<p class="sys">${mark(text)} <span class="t">${time(r.ts)}</span></p>`;
        continue;
      }
      if (r.author !== speaker) {
        speaker = r.author;
        html += `<p class="who">${th(thByName.get(r.author), "small")} <b>${esc(r.author || "?")}</b>${r.role ? ` <span class="muted">${esc(r.role)}</span>` : ""} <span class="t">${time(r.ts)}</span></p>`;
      }
      html += r.kind === "replay"
        ? `<p class="msg replay">🎬 <i>Shared a replay: ${mark(r.text)}</i></p>`
        : `<p class="msg">${mark(r.text)}</p>`;
    }
    return html;
  }).join("");
}

// ---------------------------------------------------------------- shell
// Light by default; the header switch picks night blossom, remembered in this browser only.
function setTheme(dark, save = false) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#1b1418" : "#fbf4ef";
  document.getElementById("mode").textContent = dark ? "Light mode" : "Dark mode";
  if (save) try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) { /* storage blocked */ }
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("theme"); } catch (e) { /* storage blocked */ }
setTheme(savedTheme === "dark");
document.getElementById("mode").addEventListener("click", () => setTheme(document.documentElement.dataset.theme !== "dark", true));

const TABS = [["overview", "Overview"], ["members", "Members"], ["war", "War"], ["cwl", "CWL"], ["streaks", "Streaks"], ["leaderboards", "Leaderboards"]];

const moved = (to) => { setTimeout(() => location.replace(to)); return ""; };

// Anonymous visit counts (admin.py /visit; no IPs are kept): which tab was shown and, for the first one
// of a visit, which site the visitor came from. Only on the clan's own domains, where the server sits
// in front of the site.
const COUNT_HOSTS = new Set(["lovelycoc.com", "turtscocclan.com"]);
const COUNT_PAGES = new Set(["overview", "news", "members", "player", "war", "cwl", "streaks", "leaderboards"]);
let firstView = true;
function countView(page) {
  if (!COUNT_HOSTS.has(location.hostname) || !COUNT_PAGES.has(page) || ADMIN) return;
  let ref = "";
  try { if (firstView && document.referrer) ref = new URL(document.referrer).hostname; } catch (e) { /* not a URL */ }
  const body = JSON.stringify({ page, load: firstView, ref: COUNT_HOSTS.has(ref) ? "" : ref });
  firstView = false;
  try { navigator.sendBeacon("/visit", new Blob([body], { type: "text/plain" })); } catch (e) { /* not counted */ }
}

function route() {
  const [, page = "overview", a, b] = location.hash.split("/");
  if (ADMIN?.setup && page !== "admin") { location.hash = "#/admin/setup"; return; }
  const current = { player: "members", news: "overview" }[page] || page;
  document.querySelectorAll("#tabs a").forEach((t) => t.classList.toggle("on", t.dataset.tab === current));
  const render = {
    overview, news: newsPage, members: membersPage, war: () => warPage(a), cwl: () => cwlPage(a, b), leaderboards: () => leaderboardsPage(a, b),
    streaks: () => streaksPage(a), player: () => playerPage(decodeURIComponent(a || ""), b), admin: () => adminSub(a),
    // Old addresses of the admin pages, from before the Admin tab.
    leaders: () => moved(`#/admin${a ? `/${a}` : ""}`), chat: () => moved("#/admin/chat"),
  }[page] || overview;
  document.getElementById("page").innerHTML = render();
  window.scrollTo(0, 0);
  countView(page || "overview");
}

async function main() {
  try {
    DATA = await (await fetch(`data.json?v=${Math.floor(Date.now() / 600000)}`)).json();
  } catch (e) {
    document.getElementById("page").innerHTML = `<p class="empty">Couldn't load the clan data.</p>`;
    return;
  }
  MEMBERS = new Map(DATA.members.map((m) => [m.tag, m]));
  const c = DATA.clan;
  const badge = document.getElementById("badge");
  if (c.badge) { badge.src = c.badge; badge.hidden = false; }
  document.title = `${c.name} · Clash of Clans`;
  document.getElementById("clan-name").textContent = c.name;
  document.getElementById("kicker").textContent = `Clash of Clans · ${c.tag}`;
  document.getElementById("clan-sub").innerHTML = [`Level ${num(c.level)} clan`, esc(c.war_league), c.win_streak > 1 && `${num(c.win_streak)}-war win streak`]
    .filter(Boolean).map((x) => `<span>${x}</span>`).join(" · ");
  await checkAdmin();
  const tabs = ADMIN && !ADMIN.setup ? [...TABS, ["admin", "Admin"]] : TABS;
  document.getElementById("tabs").innerHTML = `<div class="in">${tabs.map(([k, v]) => `<a href="#/${k}" data-tab="${k}">${v}</a>`).join("")}</div>`;
  document.getElementById("foot").innerHTML = `<p>Updated ${ago(DATA.generated_at)}. Data from the Clash of Clans API, refreshed hourly by our clan bot.</p>
    <p>This content is not affiliated with, endorsed, sponsored, or specifically approved by Supercell and Supercell is not responsible for it.</p>
    ${adminFooter()}`;
  setupAdmin();
  setupViewer();
  // Table rows that open a page (CWL rounds): a click anywhere on the row, not just its link.
  document.getElementById("page").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a") && !String(getSelection())) location.hash = row.dataset.href;
  });
  window.addEventListener("hashchange", () => { document.getElementById("viewer").close(); route(); });
  route();
}

main();
