// Lovely clan mini site. Reads data.json (rebuilt hourly by the clan bot) and renders
// everything client-side with hash routes: #/overview, #/news, #/members, #/war, #/war/<start>, #/cwl,
// #/cwl/<round>, #/cwl/history, #/cwl/history/<season>, #/streaks, #/streaks/top, #/leaderboards,
// #/player/<tag>; and, for the signed-in admin only, #/leaders[/log|/strikes] and #/chat.
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
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const ROLES = { leader: "Leader", coLeader: "Co-leader", admin: "Elder", member: "Member" };
const ROLE_ORDER = { leader: 0, coLeader: 1, admin: 2, member: 3 };
const RESULT = { W: "Won", L: "Lost", T: "Tied", inWar: "Live", preparation: "Prep" };
const res = (r) => `<span class="res ${r}">${RESULT[r] || ""}</span>`;
// The Clash of Clans war icon: two crossed swords. Marks links that open a war.
const SWORDS = `<svg class="swords" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(45 32 32)"><path class="bl" d="M32 3L37.5 11V41h-11V11Z"/><path class="fu" d="M32 10V38"/><rect class="gd" x="19" y="40" width="26" height="6.5" rx="3.2"/><rect class="gr" x="28.8" y="46.5" width="6.4" height="10" rx="1.6"/><circle class="gd" cx="32" cy="59" r="3.8"/></g><g transform="rotate(-45 32 32)"><path class="bl" d="M32 3L37.5 11V41h-11V11Z"/><path class="fu" d="M32 10V38"/><rect class="gd" x="19" y="40" width="26" height="6.5" rx="3.2"/><rect class="gr" x="28.8" y="46.5" width="6.4" height="10" rx="1.6"/><circle class="gd" cx="32" cy="59" r="3.8"/></g></svg>`;
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
      html: (m) => (m.attacks.length ? m.attacks.map((a) => `<span class="muted">→ #${a.pos ?? "?"}</span> ${th(a.th, "small")} ${stars(a.stars)} <b class="${a.pct >= 100 ? "gold" : ""}">${Math.round(a.pct)}%</b>`).join("<br>") : `<span class="muted">${pending}</span>`),
    },
    {
      label: "Defense", key: (m) => -m.defense.stars,
      html: (m) => (m.defense.n ? `<span class="${m.defense.stars < 3 ? "win" : "loss"}">${stars(m.defense.stars)} ${Math.round(m.defense.pct)}%</span>${m.defense.n > 1 ? ` <span class="muted">· hit ${m.defense.n}×</span>` : ""}` : `<span class="muted">not attacked</span>`),
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
    const scored = w.lineup.filter((m) => m.attacks.length).map((m) => ({
      m, s: m.attacks.reduce((t, a) => t + a.stars, 0), d: m.attacks.reduce((t, a) => t + a.pct, 0), x: m.attacks.filter((a) => a.stars === 3).length,
    })).sort((a, b) => b.s - a.s || b.d - a.d).slice(0, 3);
    if (scored.length) html += `<h3>Best attacks</h3>` + names(scored.map(({ m, s, x }) => `${th(m.th, "small")} ${who(m.tag, m.name)} <b>${s}</b>${star}${x > 1 ? ` <span class="muted">${x} triples</span>` : ""}`));
    if (held.length) html += `<h3>Held (${held.length})</h3>` + names(held.map((m) => `${th(m.th, "small")} ${who(m.tag, m.name)}`));
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
  const fastest = DATA.members.filter((m) => m.progress?.gained > 0).sort((a, b) => b.progress.per_week - a.progress.per_week).slice(0, 5);
  const gamers = DATA.members.filter((m) => m.games?.points > 0).sort((a, b) => b.games.points - a.games.points);
  const games = DATA.members.find((m) => m.games)?.games;
  html += `<div class="cols">
    <section><h2>Clan news</h2>${newsList((DATA.news || []).slice(0, 6))}
      ${(DATA.news || []).length > 6 ? `<p class="note"><a class="link" href="#/news">All the news</a></p>` : ""}</section>
    <section><h2>Best 3-star rate</h2>${rankList(war3.map((m) => [m, pct(m.war.all.triples / m.war.all.attacks), `${m.war.all.attacks} attacks`]))}</section>
    <section><h2>Top donors</h2>${rankList(donors.map((m) => [m, num(m.donations_total), `got ${num(m.received_total)}`]))}</section>
    ${perfect.length ? `<section><h2>Perfect CWLs</h2>${rankList(perfect.map((p) => [p, num(p.perfect), p.streak > 1 ? `${p.streak} in a row` : `of ${p.shown} seasons`]))}
      <p class="note"><a class="link" href="#/cwl/history">Every season</a></p></section>` : ""}
    <section><h2>Fastest progress</h2>${rankList(fastest.map((m) => [m, `${m.progress.per_week}<span class="muted unit">/wk</span>`, `+${num(m.progress.gained)} levels in ${m.progress.days} days`]))}
      <p class="note">Hero, troop, spell and equipment levels gained a week. <a class="link" href="#/leaderboards/progress">Everyone</a></p></section>
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
  const rounds = `<section><h2>Rounds</h2><div class="fixtures">${c.rounds.map((r) => {
    const prep = r.state === "preparation";
    return `<a href="#/cwl/${r.round}"><span class="rd">R${r.round}</span>${res(result(r))}<span class="opp" dir="auto">${esc(r.opponent)}</span>
      <span class="sc">${prep ? "" : `${r.stars[0]}–${r.stars[1]}`}</span><span class="pc">${prep ? "" : `${Math.round(r.pct[0])}% – ${Math.round(r.pct[1])}%`}</span></a>`;
  }).join("")}</div></section>`;
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
  return `<h2>${num(DATA.members.length)} members</h2>
    <p class="note">Donations are everything given since the bot started counting, so they don't reset each season.</p>` + table(rows, [
    { label: "TH", key: (m) => m.th, html: (m) => th(m.th) },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => who(m.tag, m.name) },
    { label: "Role", key: (m) => -ROLE_ORDER[m.role], html: (m) => `<span class="role ${esc(m.role)}">${ROLES[m.role] || ""}</span>` },
    { label: "League", key: (m) => m.league_id ?? -1, html: (m) => (m.league_icon ? `<img class="league" src="${esc(m.league_icon)}" alt="">` : "") + `<span class="muted">${esc(m.league || "Unranked")}</span>` },
    { label: "Donated", key: (m) => m.donations_total ?? -1, html: (m) => (m.donations_total == null ? `<span class="muted">–</span>` : `<b>${num(m.donations_total)}</b>`), num: true },
    { label: "3★ rate", key: (m) => (m.war.all.attacks ? m.war.all.triples / m.war.all.attacks : -1), html: (m) => (m.war.all.attacks ? pct(m.war.all.triples / m.war.all.attacks) : "–"), num: true },
    { label: "Defense held", key: (m) => (m.defense.all.attacked ? m.defense.all.held / m.defense.all.attacked : -1), html: (m) => (m.defense.all.attacked ? pct(m.defense.all.held / m.defense.all.attacked) : "–"), num: true },
    { label: "Perfect CWLs", key: (m) => m.cwl.perfect * 100 + m.cwl.streak, html: (m) => (m.cwl.perfect ? `<span class="perfect-n">${m.cwl.perfect}</span>` : `<span class="muted">–</span>`), num: true },
    { label: "In a row", key: (m) => m.cwl.streak, html: (m) => (m.cwl.streak ? m.cwl.streak : `<span class="muted">–</span>`), num: true },
  ], 2);
}

const METRICS = {
  triple_rate: ["3-star rate", (s) => s.attacks >= 3 && s.triples / s.attacks, (v) => pct(v), (s) => `${s.attacks} attacks`],
  avg_stars: ["Average stars", (s) => s.attacks >= 3 && s.avg_stars, (v) => v.toFixed(2) + " " + star, (s) => `${s.attacks} attacks`],
  stars: ["Total stars", (s) => s.attacks && s.triples * 3 + s.by_stars[2] * 2 + s.by_stars[1], (v) => `${v} ${star}`, (s) => `${s.attacks} attacks`],
  missed: ["Missed attacks", (s) => s.missed || false, (v) => v, (s) => `${s.wars} wars`],
  hold_rate: ["Defense hold rate", (s, d) => d.attacked >= 3 && d.held / d.attacked, (v) => pct(v), (s, d) => `held ${d.held} of ${d.attacked}`],
  soe: ["Stars vs expected", (s) => s.attacks >= 3 && s.soe, (v) => (v > 0 ? "+" : "") + v.toFixed(2), (s) => `${s.attacks} attacks · ${s.up} up`],
  donations_total: ["Donations", null, (v) => num(v), null],
  progress: ["Fastest progress", null, (v) => `${v}/week`, null],
  games: ["Clan Games points", null, (v) => num(v), null],
};
// Leaderboards that aren't about wars (the war filter doesn't apply).
const NOT_WARS = new Set(["donations_total", "progress", "games"]);

function leaderboardsPage(metric = "triple_rate", scope = "all") {
  if (!METRICS[metric]) metric = "triple_rate";
  const [label, value, fmt, detail] = METRICS[metric];
  let rows;
  if (metric === "donations_total") rows = DATA.members.filter((m) => m.donations_total != null).map((m) => [m, m.donations_total, `got ${num(m.received_total)}`]);
  else if (metric === "progress") rows = DATA.members.filter((m) => m.progress).map((m) => [m, m.progress.per_week, `+${m.progress.gained} levels in ${m.progress.days} days`]);
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
    <h2>${esc(label)}</h2>${rankList(rows.slice(0, 25).map(([m, v, d]) => [m, fmt(v), d]))}
    <p class="note">Rates and averages need at least 3 attacks (or defenses). War stats come from wars the bot has recorded.</p>`;
}

function playerPage(tag) {
  const m = MEMBERS.get(tag);
  if (!m) return `<p class="empty">That player isn't in the clan right now.</p>`;
  const since = m.joined ? ` · in the clan since ${when(m.joined, { month: "short", day: "numeric", year: "numeric" })}` : "";
  let html = `<div class="player-head">${th(m.th)}<div><h2>${esc(m.name)}</h2><p>${ROLES[m.role] || ""} · ${esc(m.tag)} · ${esc(m.league || "Unranked")}${since}</p></div></div>`;
  if (ADMIN) html += leaderBox(tag);
  html += ledger([
    m.donations_total != null && [num(m.donations_total), `donated since ${when(m.tracked_since)}`, "gold"],
    m.donations_total != null && [num(m.received_total), "received"],
  ]);
  if (m.progress || m.games) {
    html += `<h3>Progress</h3>` + ledger([
      m.progress && [`+${num(m.progress.gained)}`, `upgrade levels in ${m.progress.days} days`, "gold"],
      m.progress && [`${m.progress.per_week}`, "levels a week"],
      m.progress && m.progress.th_to > m.progress.th_from && [`TH${m.progress.th_from} → ${m.progress.th_to}`, "town hall"],
      m.games && [num(m.games.points), `Clan Games points${m.games.ongoing ? " so far" : ""}`],
    ]);
  }
  for (const [scope, name] of [["all", "All wars"], ["cwl", "CWL"], ["regular", "Regular wars"]]) {
    const s = m.war[scope], d = m.defense[scope];
    if (!s.attacks && !d.attacked) continue;
    html += `<h3>${name}</h3>` + ledger([
      [s.attacks ? pct(s.triples / s.attacks) : "–", "3-star rate", "gold"],
      [num(s.attacks), "attacks"],
      [s.avg_stars.toFixed(2), "avg stars"],
      [`${Math.round(s.avg_destruction)}%`, "avg destruction"],
      [num(s.missed), "missed", s.missed ? "loss" : ""],
      s.attacks >= 3 && [(s.soe > 0 ? "+" : "") + s.soe.toFixed(2), "stars vs expected", s.soe > 0 ? "win" : s.soe < 0 ? "loss" : ""],
      d.attacked && [pct(d.held / d.attacked), "defenses held", d.held * 2 >= d.attacked ? "win" : "loss"],
      d.attacked && [num(d.attacked), "times attacked"],
    ]);
  }
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
      { label: "Result", key: null, html: (a) => `${stars(a.stars)} <b>${Math.round(a.pct)}%</b>` },
      { label: "Target", key: null, html: (a) => (a.pos ? `<span class="muted">#${a.pos}</span> ${th(a.th, "small")}` : "?") },
      { label: "War", key: null, html: (a) => `<span class="muted">${a.kind === "cwl" ? `CWL round ${a.round}` : "War"} vs</span> ${esc(a.opponent)}` },
      { label: "Date", key: null, html: (a) => `<span class="muted">${when(a.start)}</span>`, num: true },
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
function adminSub(sub) {
  if (sub === "setup") return setupPage();
  if (sub === "users") return usersPage();
  if (sub === "password") return passwordPage();
  return adminPage();
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
  if (!ADMIN.setup) { setTimeout(() => { location.hash = "#/leaders"; }); return ""; }
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
        () => { location.hash = "#/leaders"; location.reload(); });
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
        <td>${u.setup ? `<span class="loss">not set up yet</span>` : "ready"}</td>
        <td class="muted">${u.last_login ? ago(u.last_login) : "never"}</td>
        <td class="num">${u.role === "owner" ? "" : `<button type="button" class="mode" data-reset="${esc(u.username)}">reset</button> · <button type="button" class="mode" data-remove="${esc(u.username)}">remove</button>`}</td></tr>`).join("")}</tbody></table></div>`;
      list.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Give ${b.dataset.reset} a new temporary password? Their authenticator entry stops working and they set up again.`)) return;
        const r = await adminPost("/admin/api/users/reset", { username: b.dataset.reset });
        const data = await r.json().catch(() => ({}));
        shown.innerHTML = r.ok ? temp(data) : `<span class="loss">${esc(data.error || "That didn't work.")}</span>`;
        draw();
      }));
      list.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(`Remove ${b.dataset.remove}? They're signed out everywhere.`)) return;
        const r = await adminPost("/admin/api/users/remove", { username: b.dataset.remove });
        const data = await r.json().catch(() => ({}));
        shown.innerHTML = r.ok ? "" : `<span class="loss">${esc(data.error || "That didn't work.")}</span>`;
        draw();
      }));
    };
    const temp = (data) => `Give <b>${esc(data.username)}</b> this temporary password, by a private message: <b class="key">${esc(data.temporary_password)}</b>.
      It's shown once. They sign in at <a class="link" href="https://${ADMIN_HOST}/#/admin">${ADMIN_HOST}</a>, then choose their own password and add the authenticator.`;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      formPost(form, "/admin/api/users/add", { username: form.username.value }, (data) => {
        shown.innerHTML = temp(data);
        form.reset();
        form.querySelector("button[type=submit]").disabled = false;
        form.querySelector(".msg").textContent = "";
        draw();
      });
    });
    draw();
  });
  return `<h2>Users</h2>
    <p class="note">Everyone here sees the leaders' pages and the chat log. New users get a temporary password and must choose their own, plus an authenticator, before they see anything.</p>
    <div id="users"><p class="empty">Loading…</p></div>
    <h3>Add a user</h3>
    <form id="adduser" class="signin" autocomplete="off">
      <label>Username (letters, digits, dots, dashes) <input name="username" required pattern="[a-z0-9][a-z0-9._-]{1,31}" maxlength="32" autocapitalize="none" spellcheck="false"></label>
      <button type="submit" class="join">Add</button>
      <p class="note msg" role="status"></p>
    </form>
    <p class="aside" id="temp" hidden></p>`;
}


function adminFooter() {
  const here = location.hostname === ADMIN_HOST;
  if (!ADMIN) return `<p class="admin"><a href="${here ? "" : `https://${ADMIN_HOST}/`}#/admin" rel="nofollow">admin</a></p>`;
  if (ADMIN.setup) return `<p class="admin">Signed in as ${esc(ADMIN.user)} · <a href="#/admin/setup">finish setting up your account</a> ·
    <button type="button" id="signout">sign out</button></p>`;
  return `<p class="admin">Signed in as ${esc(ADMIN.user)} · <a href="#/leaders">leaders</a> · <a href="#/chat">chat log</a> ·
    ${ADMIN.role === "owner" ? `<a href="#/admin/users">users</a> · ` : ""}<a href="#/admin/password">password</a> ·
    <button type="button" id="signout">sign out</button></p>`;
}

const adminPost = (path, body) => fetch(path, {
  method: "POST", credentials: "same-origin", cache: "no-store",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function setupAdmin() {
  const out = document.getElementById("signout");
  if (out) out.addEventListener("click", async () => {
    try { await adminPost("/admin/api/logout", {}); } catch (e) { /* offline */ }
    location.href = "/";
  });
}

// The sign-in form: username, password and the 6-digit code from the authenticator app.
function adminPage() {
  if (location.hostname !== ADMIN_HOST) return `<p class="empty">Sign in on <a class="link" href="https://${ADMIN_HOST}/#/admin">${ADMIN_HOST}</a>.</p>`;
  if (ADMIN) { setTimeout(() => { location.hash = ADMIN.setup ? "#/admin/setup" : "#/leaders"; }); return ""; }
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
          location.hash = (await r.json().catch(() => ({}))).setup ? "#/admin/setup" : "#/leaders";
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
      <label>Code from your authenticator app <input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" required maxlength="7"></label>
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
  if (location.hash.startsWith("#/chat")) route();
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
  if (/^#\/(leaders|player)\b/.test(location.hash)) route();
}

const HK_FILTERS = {
  all: ["Everyone, most in need of a look first", () => true], quiet: ["Quiet for 7+ days", (r) => r.quiet >= 7],
  out: ["War preference: out", (r) => r.war === "out"], missed: ["Missed attacks lately", (r) => r.missed > 0],
  strikes: ["Has strikes (30 days)", (r) => r.strikes > 0], new: ["Joined in the last 14 days", (r) => r.new],
};
const LOG_KINDS = {
  "": ["Everything", () => true], members: ["Joins and leaves", (e) => ["join", "rejoin", "leave"].includes(e.kind)],
  roles: ["Promotions and demotions", (e) => ["promote", "demote"].includes(e.kind)],
  upgrades: ["Upgrades, milestones, renames", (e) => ["th", "milestone", "rename"].includes(e.kind)],
  warned: ["Warnings", (e) => e.kind === "warned"],
};
const played = (r) => (r.seen ? (r.quiet < 1 ? "today" : `${Math.round(r.quiet)}d ago`) : `not in ${Math.round(r.quiet)}d`);

// Leaders only (admin.py, never data.json): housekeeping, the full member log and strikes.
function leadersPage(sub) {
  if (!ADMIN) return `<p class="empty">Sign in (<a class="link" href="#/admin">admin</a>) to see this.</p>`;
  if (!LEADER) { loadLeader(); return `<p class="empty">Loading…</p>`; }
  if (LEADER.error) return `<p class="empty">${esc(LEADER.error)}</p>`;
  const nav = `<div class="subnav">${[["", "Housekeeping"], ["log", "Member log"], ["strikes", "Strikes"]]
    .map(([k, v]) => `<a href="#/leaders${k ? `/${k}` : ""}" class="${(sub || "") === k ? "on" : ""}">${v}</a>`).join("")}</div>`;
  return nav + (sub === "log" ? memberLogPage() : sub === "strikes" ? strikesPage() : housekeepingPage());
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
  return `<h2>Housekeeping <small>${num(rows.length)} members · only you see this</small></h2>` + ledger([
    [num(count("quiet")), "quiet 7+ days", count("quiet") ? "loss" : ""],
    [num(count("out")), "war preference out"],
    [num(count("missed")), "missed attacks lately", count("missed") ? "loss" : ""],
    [num(count("strikes")), "with strikes (30 days)"],
    [num(count("new")), "joined in 14 days"],
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
    { label: "Member", key: (r) => r.name.toLowerCase(), html: (r) => `${th(r.th, "small")} ${who(r.tag, r.name)} <span class="role ${esc(r.role)}">${ROLES[r.role] || ""}</span>` },
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
  return html + `</section>`;
}

// The recorded clan chat: newest day first, each day in order, runs of messages under their speaker.
function chatPage() {
  if (!ADMIN) return `<p class="empty">Sign in (<a class="link" href="#/admin">admin</a>) to see the clan chat.</p>`;
  if (!CHAT) { loadChat(); return `<p class="empty">Loading the clan chat…</p>`; }
  if (CHAT.error) return `<p class="empty">${esc(CHAT.error)}</p>`;
  setTimeout(() => {
    const find = document.getElementById("chatfind"), who = document.getElementById("chatwho");
    if (!find) return;
    find.value = chatView.find;
    who.value = chatView.who;
    const redraw = () => { chatView.find = find.value; chatView.who = who.value; document.getElementById("chatlog").innerHTML = chatLog(); };
    find.addEventListener("input", redraw);
    who.addEventListener("change", redraw);
  });
  const counts = {};
  CHAT.rows.forEach((r) => { if (r.author && r.kind !== "system") counts[r.author] = (counts[r.author] || 0) + 1; });
  const people = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return `<h2>Clan chat <small>${num(CHAT.rows.length)} messages${CHAT.checked ? ` · checked ${ago(CHAT.checked)}` : ""} · only you see this</small></h2>
    <div class="controls"><input id="chatfind" type="search" placeholder="Find in the chat" aria-label="Find in the chat" autocomplete="off">
      <select id="chatwho" aria-label="Member"><option value="">Everyone</option>${people.map((p) => `<option value="${esc(p)}">${esc(p)} (${counts[p]})</option>`).join("")}</select></div>
    <div id="chatlog" class="chat">${chatLog()}</div>
    <p class="note">Times are approximate (the game only says "3h ago"). Read from the game by the clan bot's reader.</p>`;
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
  return days.reverse().map(({ day, rows: list }) => {
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

function route() {
  const [, page = "overview", a, b] = location.hash.split("/");
  if (ADMIN?.setup && page !== "admin") { location.hash = "#/admin/setup"; return; }
  const current = { player: "members", news: "overview" }[page] || page;
  document.querySelectorAll("#tabs a").forEach((t) => t.classList.toggle("on", t.dataset.tab === current));
  const render = {
    overview, news: newsPage, members: membersPage, war: () => warPage(a), cwl: () => cwlPage(a, b), leaderboards: () => leaderboardsPage(a, b),
    streaks: () => streaksPage(a), player: () => playerPage(decodeURIComponent(a || "")), chat: chatPage, admin: () => adminSub(a),
    leaders: () => leadersPage(a),
  }[page] || overview;
  document.getElementById("page").innerHTML = render();
  window.scrollTo(0, 0);
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
  const tabs = ADMIN && !ADMIN.setup ? [...TABS, ["leaders", "Leaders"], ["chat", "Chat log"]] : TABS;
  document.getElementById("tabs").innerHTML = `<div class="in">${tabs.map(([k, v]) => `<a href="#/${k}" data-tab="${k}">${v}</a>`).join("")}</div>`;
  document.getElementById("foot").innerHTML = `<p>Updated ${ago(DATA.generated_at)}. Data from the Clash of Clans API, refreshed hourly by our clan bot.</p>
    <p>This content is not affiliated with, endorsed, sponsored, or specifically approved by Supercell and Supercell is not responsible for it.</p>
    ${adminFooter()}`;
  setupAdmin();
  setupViewer();
  window.addEventListener("hashchange", () => { document.getElementById("viewer").close(); route(); });
  route();
}

main();
