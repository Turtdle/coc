// Lovely clan mini site. Reads data.json (rebuilt hourly by the clan bot) and renders
// everything client-side with hash routes: #/overview, #/members, #/war, #/cwl, #/cwl/<round>,
// #/cwl/history, #/cwl/history/<season>, #/streaks, #/streaks/top, #/leaderboards, #/raids, #/player/<tag>.
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
// A player's name, linked to their page while they're in the clan.
const who = (tag, name) => (tag && MEMBERS.has(tag) ? `<a href="#/player/${encodeURIComponent(tag)}">${esc(name)}</a>` : esc(name));
const names = (items) => `<p class="names">${items.map((x) => `<span class="n">${x}</span>`).join("")}</p>`;
// Figures in a row between rules: [[value html, label, class], ...]; falsy entries are skipped.
const ledger = (items, cls = "") => `<div class="ledger ${cls}"><div class="in">${items.filter(Boolean)
  .map(([value, label, cls = ""]) => `<div><b class="${cls}">${value}</b><span>${esc(label)}</span></div>`).join("")}</div></div>`;

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
function table(rows, columns, sortKey = null, sortDir = -1, rowClass = () => "") {
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
        .map((r) => `<tr class="${rowClass(r)}">${columns.map((c) => `<td class="${c.num ? "num" : ""} ${c.wrap ? "wrap" : ""}">${c.html(r)}</td>`).join("")}</tr>`)
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
  return `<div class="sheet"><table id="${id}"><thead><tr>${columns
    .map((c) => `<th class="${c.num ? "num" : ""} ${c.key ? "sort" : ""}">${esc(c.label)}</th>`)
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
  return href ? `<a class="now scoreboard" href="${href}">${inner}</a>` : `<div class="scoreboard">${inner}</div>`;
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
  if (w.state === "preparation") return `<p class="note">Preparation day: attacks open in ${until(w.start)}.</p>`;
  const live = w.state === "inWar";
  const left = w.lineup.filter((m) => m.attacks.length < w.per);
  const hit = w.lineup.filter((m) => m.defense.n), held = hit.filter((m) => m.defense.stars < 3);
  let html = ledger([
    [num(w.us.total - w.us.used), live ? "our attacks left" : "attacks missed", live ? "gold" : w.us.total > w.us.used ? "loss" : ""],
    [hit.length ? `${held.length}<span class="muted">/${hit.length}</span>` : "–", "bases held"],
    w.them.used != null && [num(w.them.total - w.them.used), live ? "enemy attacks left" : "enemy attacks missed"],
  ]);
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
    [esc(c.capital_league || "–"), "capital league"],
    [`${num(c.members)}<span class="muted">/50</span>`, "members"],
    DATA.streaks?.length && [`<a href="#/streaks">${num(DATA.streaks.length)}</a>`, "win streaks we ended"],
    [c.required_th > 1 ? `TH${num(c.required_th)}+` : "Any TH", { inviteOnly: "invite only", open: "open to join", closed: "closed" }[c.type] || "to join"],
  ], "four");
  if (c.labels.length) html += `<p class="tags">${c.labels.map(esc).join(" · ")}</p>`;

  if (live?.kind === "cwl") {
    const where = cwl?.position ? `<small>${ordinal(cwl.position)} of ${cwl.clans} in the group</small>` : "";
    html += `<h2>CWL, round ${live.round} ${where}</h2>${scoreboard(live, "#/cwl")}`;
  } else if (live) {
    html += `<h2>${live.state === "warEnded" ? "Last war" : "This war"}</h2>${scoreboard(live, "#/war")}`;
  }

  const war3 = DATA.members.filter((m) => m.war.all.attacks >= 3)
    .sort((a, b) => b.war.all.triples / b.war.all.attacks - a.war.all.triples / a.war.all.attacks || b.war.all.attacks - a.war.all.attacks).slice(0, 5);
  const donors = [...DATA.members].sort((a, b) => b.donations - a.donations).slice(0, 5);
  const perfect = (DATA.cwl_history?.perfect || []).slice(0, 5);
  html += `<div class="cols">
    <section><h2>Best 3-star rate</h2>${rankList(war3.map((m) => [m, pct(m.war.all.triples / m.war.all.attacks), `${m.war.all.attacks} attacks`]))}</section>
    <section><h2>Top donors <small>this season</small></h2>${rankList(donors.map((m) => [m, num(m.donations), `got ${num(m.received)}`]))}</section>
    ${perfect.length ? `<section><h2>Perfect CWLs</h2>${rankList(perfect.map((p) => [p, num(p.perfect), p.streak > 1 ? `${p.streak} in a row` : `of ${p.shown} seasons`]))}
      <p class="note"><a class="link" href="#/cwl/history">Every season</a></p></section>` : ""}
  </div>`;
  return html;
}

function warPage() {
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
      { label: "Opponent", key: (r) => r.opponent.toLowerCase(), html: (r) => esc(r.opponent) },
      { label: "Size", key: (r) => r.size, html: (r) => `${r.size} v ${r.size}`, num: true },
      { label: "Stars", key: (r) => r.stars[0] - r.stars[1], html: (r) => `<b>${r.stars[0]}</b> – ${r.stars[1]}`, num: true },
      { label: "Destruction", key: (r) => r.pct[0], html: (r) => `${r.pct[0].toFixed(1)}% <span class="muted">– ${r.pct[1].toFixed(1)}%</span>`, num: true },
    ], 0);
  }
  return html;
}

function cwlPage(a, b) {
  const sub = (on) => `<div class="subnav"><a href="#/cwl" class="${on ? "" : "on"}">This season</a><a href="#/cwl/history" class="${on ? "on" : ""}">Past seasons</a></div>`;
  if (a === "history") return sub(true) + (b ? historySeason(decodeURIComponent(b)) : historyPage());
  return sub(false) + (a ? roundPage(+a) : seasonPage());
}

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
  if (live) {
    html += `<h2>Round ${live.round} <small>${live.state === "inWar" ? "battle day" : "preparation day"}</small></h2>${scoreboard(live)}${warBody(live)}`;
  }
  if (c) {
    html += `<h2>Rounds</h2><div class="fixtures">${c.rounds.map((r) => {
      const prep = r.state === "preparation";
      return `<a href="#/cwl/${r.round}"><span class="rd">R${r.round}</span>${res(result(r))}<span class="opp">${esc(r.opponent)}</span>
        <span class="sc">${prep ? "" : `${r.stars[0]}–${r.stars[1]}`}</span><span class="pc">${prep ? "" : `${Math.round(r.pct[0])}% – ${Math.round(r.pct[1])}%`}</span></a>`;
    }).join("")}</div>`;
    html += `<h2>Members</h2><p class="note">Finished rounds only, like the in-game Clan tab.</p>` + table(c.members, [
      { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => `${th(MEMBERS.get(m.tag)?.th, "small")} ${who(m.tag, m.name)}` },
      { label: "Stars", key: (m) => m.stars, html: (m) => `<b>${m.stars}</b> ${star}`, num: true },
      { label: "Destruction", key: (m) => m.destruction, html: (m) => `${num(Math.round(m.destruction))}%`, num: true },
      { label: "Attacks", key: (m) => m.attacks, html: (m) => `${m.attacks}/${m.wars}`, num: true },
    ], 1);
  }
  return html;
}

function roundPage(n) {
  const c = DATA.cwl, live = DATA.war?.kind === "cwl" && DATA.war.round === n ? DATA.war : null;
  const r = c?.rounds.find((x) => x.round === n);
  let html = `<a class="back" href="#/cwl">← ${c ? seasonName(c.season) : "This season"}</a>`;
  if (live) return html + `<h2>Round ${n}</h2>${scoreboard(live)}${warBody(live)}`;
  if (!r) return html + `<p class="empty">No such round.</p>`;
  const used = r.lineup.reduce((s, m) => s + m.attacks.length, 0);
  const w = {
    state: r.state, kind: "cwl", round: r.round, per: 1, start: null, end: null, lineup: r.lineup,
    us: { name: DATA.clan.name, badge: DATA.clan.badge, stars: r.stars[0], pct: r.pct[0], size: r.lineup.length, used, total: r.lineup.length },
    them: { name: r.opponent, badge: null, stars: r.stars[1], pct: r.pct[1], size: r.lineup.length, used: null, total: r.lineup.length },
  };
  return html + `<h2>Round ${n}</h2>${scoreboard(w)}${warBody(w)}`;
}

const PERFECT_MARK = `<span class="perfect" title="21 stars from 7 attacks">perfect</span>`;

function historyPage() {
  const h = DATA.cwl_history;
  if (!h?.seasons.length) return `<p class="empty">No past seasons yet.</p>`;
  let html = `<h2>Perfect CWLs</h2>
    <p class="note">Seven attacks, seven three-stars: 21 stars. Counted over the ${h.counted} finished seasons we have.
    Names in grey aren't in the clan now (or the bot never saw them).</p>`;
  html += table(h.perfect, [
    { label: "Member", key: (p) => p.name.toLowerCase(), html: (p) => `${th(MEMBERS.get(p.tag)?.th, "small")} ${who(p.tag, p.name)}` },
    { label: "Perfect", key: (p) => p.perfect, html: (p) => `<b>${p.perfect}</b>`, num: true },
    { label: "In a row now", key: (p) => p.streak, html: (p) => (p.streak ? p.streak : `<span class="muted">–</span>`), num: true },
    { label: "Seasons on the board", key: (p) => p.shown, html: (p) => p.shown, num: true },
  ], 1, -1, (p) => (MEMBERS.has(p.tag) ? "" : "left"));

  html += `<h2>Seasons</h2>
    <p class="note">Older seasons come from the leaderboard screenshots posted in our Discord, which only show the top of the board. The bot has recorded every member since October 2026.</p>`;
  html += table(h.seasons, [
    { label: "Season", key: (s) => s.season, html: (s) => `<a class="link" href="#/cwl/history/${encodeURIComponent(s.season)}">${esc(s.label)}</a>` },
    { label: "Perfect", key: (s) => s.rows.filter((r) => r.perfect).length, html: (s) => (s.done ? num(s.rows.filter((r) => r.perfect).length) : `<span class="muted">–</span>`), num: true },
    {
      label: "Top of the board", key: null, wrap: true,
      html: (s) => {
        const perfect = s.rows.filter((r) => r.perfect), top = perfect.length ? perfect : s.rows.filter((r) => r.position === 1);
        if (!top.length) return "";
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
    : s.done ? "Recorded by the clan bot." : "Still going: finished rounds only.";
  html += `<h2>${esc(s.label)} ${s.result ? `<small>${esc(s.result)}</small>` : ""}</h2>
    <p class="note">${source}${perfect ? ` ${perfect} perfect.` : ""}${s.note ? ` ${esc(s.note)}` : ""}</p>`;
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
      <div class="proof">${s.shots.map((src, n) => `<a href="${esc(src)}" target="_blank" rel="noopener" title="Screenshot ${n + 1}"><img src="${esc(src.replace(/\.webp$/, "-t.webp"))}" alt="Proof screenshot ${n + 1}" loading="lazy"></a>`).join("")}</div>
    </article>`).join("")}</div>
    <p class="note">Logged in our Discord with <b>/streaks add</b>. Tap a screenshot for the full size.</p>`;
  return html;
}

function membersPage() {
  return `<h2>${num(DATA.members.length)} members</h2>` + table(DATA.members, [
    { label: "TH", key: (m) => m.th, html: (m) => th(m.th) },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => who(m.tag, m.name) },
    { label: "Role", key: (m) => -ROLE_ORDER[m.role], html: (m) => `<span class="role ${esc(m.role)}">${ROLES[m.role] || ""}</span>` },
    { label: "League", key: (m) => m.league || "", html: (m) => (m.league_icon ? `<img class="league" src="${esc(m.league_icon)}" alt="">` : "") + `<span class="muted">${esc(m.league || "Unranked")}</span>` },
    { label: "Donated", key: (m) => m.donations, html: (m) => `<b>${num(m.donations)}</b>`, num: true },
    { label: "Total tracked", key: (m) => m.donations_total ?? -1, html: (m) => `<span class="muted">${m.donations_total == null ? "–" : num(m.donations_total)}</span>`, num: true },
    { label: "3★ rate", key: (m) => (m.war.all.attacks ? m.war.all.triples / m.war.all.attacks : -1), html: (m) => (m.war.all.attacks ? pct(m.war.all.triples / m.war.all.attacks) : "–"), num: true },
    { label: "Defense held", key: (m) => (m.defense.all.attacked ? m.defense.all.held / m.defense.all.attacked : -1), html: (m) => (m.defense.all.attacked ? pct(m.defense.all.held / m.defense.all.attacked) : "–"), num: true },
  ], 2);
}

const METRICS = {
  triple_rate: ["3-star rate", (s) => s.attacks >= 3 && s.triples / s.attacks, (v) => pct(v), (s) => `${s.attacks} attacks`],
  avg_stars: ["Average stars", (s) => s.attacks >= 3 && s.avg_stars, (v) => v.toFixed(2) + " " + star, (s) => `${s.attacks} attacks`],
  stars: ["Total stars", (s) => s.attacks && s.triples * 3 + s.by_stars[2] * 2 + s.by_stars[1], (v) => `${v} ${star}`, (s) => `${s.attacks} attacks`],
  missed: ["Missed attacks", (s) => s.missed || false, (v) => v, (s) => `${s.wars} wars`],
  hold_rate: ["Defense hold rate", (s, d) => d.attacked >= 3 && d.held / d.attacked, (v) => pct(v), (s, d) => `held ${d.held} of ${d.attacked}`],
  donations: ["Donations this season", null, (v) => num(v), null],
  donations_total: ["Donations (total tracked)", null, (v) => num(v), null],
};

function leaderboardsPage(metric = "triple_rate", scope = "all") {
  if (!METRICS[metric]) metric = "triple_rate";
  const [label, value, fmt, detail] = METRICS[metric];
  let rows;
  if (metric === "donations") rows = DATA.members.map((m) => [m, m.donations, `got ${num(m.received)}`]);
  else if (metric === "donations_total") rows = DATA.members.filter((m) => m.donations_total != null).map((m) => [m, m.donations_total, `got ${num(m.received_total)}`]);
  else rows = DATA.members.map((m) => [m, value(m.war[scope], m.defense[scope]), detail(m.war[scope], m.defense[scope])]).filter((r) => r[1] !== false && r[1] !== 0);
  rows.sort((a, b) => b[1] - a[1]);
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join("");
  setTimeout(() => {
    const go = () => { location.hash = `#/leaderboards/${document.getElementById("metric").value}/${document.getElementById("scope").value}`; };
    document.getElementById("metric").onchange = go;
    document.getElementById("scope").onchange = go;
  });
  return `<div class="controls"><select id="metric" aria-label="Stat">${opts(METRICS, metric)}</select><select id="scope" aria-label="Wars" ${metric.startsWith("donations") ? "disabled" : ""}>${opts({ all: "All wars", cwl: "CWL", regular: "Regular wars" }, scope)}</select></div>
    <h2>${esc(label)}</h2>${rankList(rows.slice(0, 25).map(([m, v, d]) => [m, fmt(v), d]))}
    <p class="note">Rates and averages need at least 3 attacks (or defenses). War stats come from wars the bot has recorded.</p>`;
}

function raidsPage(index = 0) {
  if (!DATA.raids.length) return `<p class="empty">No raid weekends yet.</p>`;
  const r = DATA.raids[index] || DATA.raids[0], raided = new Set(r.members.map((m) => m.tag));
  const missing = DATA.members.filter((m) => !raided.has(m.tag));
  setTimeout(() => { document.getElementById("weekend").onchange = (e) => { location.hash = `#/raids/${e.target.value}`; }; });
  return `<div class="controls"><select id="weekend" aria-label="Raid weekend">${DATA.raids.map((x, i) => `<option value="${i}" ${x === r ? "selected" : ""}>Weekend of ${when(x.start, { month: "long", day: "numeric" })}</option>`).join("")}</select>
    <span class="muted">${r.state === "ongoing" ? `ends in ${until(r.end)}` : "ended"}</span></div>`
    + ledger([[num(r.loot), "capital gold", "gold"], [num(r.raids), "raids completed"], [num(r.districts), "districts destroyed"], [num(r.attacks), "attacks"], [num(r.members.length), "raiders"], [num(r.medals), "medals"]])
    + `<h2>Raiders</h2>` + (r.members.length ? table(r.members, [
      { label: "Raider", key: (m) => m.name.toLowerCase(), html: (m) => who(m.tag, m.name) },
      { label: "Attacks", key: (m) => m.attacks, html: (m) => `${m.attacks}/${m.limit}`, num: true },
      { label: "Capital gold", key: (m) => m.loot, html: (m) => `<b>${num(m.loot)}</b>`, num: true },
    ], 2) : `<p class="empty">Nobody raided.</p>`)
    + (missing.length ? `<h3>Didn't raid (${missing.length})</h3>${names(missing.map((m) => who(m.tag, m.name)))}` : "");
}

function playerPage(tag) {
  const m = MEMBERS.get(tag);
  if (!m) return `<p class="empty">That player isn't in the clan right now.</p>`;
  let html = `<div class="player-head">${th(m.th)}<div><h2>${esc(m.name)}</h2><p>${ROLES[m.role] || ""} · ${esc(m.tag)} · ${esc(m.league || "Unranked")}</p></div></div>`;
  html += ledger([
    [num(m.donations), "donated this season", "gold"],
    [num(m.received), "received this season"],
    m.donations_total != null && [num(m.donations_total), `donated since ${when(m.tracked_since)}`],
  ]);
  for (const [scope, name] of [["all", "All wars"], ["cwl", "CWL"], ["regular", "Regular wars"]]) {
    const s = m.war[scope], d = m.defense[scope];
    if (!s.attacks && !d.attacked) continue;
    html += `<h3>${name}</h3>` + ledger([
      [s.attacks ? pct(s.triples / s.attacks) : "–", "3-star rate", "gold"],
      [num(s.attacks), "attacks"],
      [s.avg_stars.toFixed(2), "avg stars"],
      [`${Math.round(s.avg_destruction)}%`, "avg destruction"],
      [num(s.missed), "missed", s.missed ? "loss" : ""],
      d.attacked && [pct(d.held / d.attacked), "defenses held", d.held * 2 >= d.attacked ? "win" : "loss"],
      d.attacked && [num(d.attacked), "times attacked"],
    ]);
  }
  const seasons = (DATA.cwl_history?.seasons || []).flatMap((s) => s.rows.filter((r) => r.tag === tag).map((r) => ({ ...r, s })));
  if (seasons.length) {
    const perfect = seasons.filter((r) => r.perfect).length;
    html += `<h2>CWL seasons ${perfect ? `<small>${perfect} perfect</small>` : ""}</h2>` + table(seasons, [
      { label: "Season", key: (r) => r.s.season, html: (r) => `<a class="link" href="#/cwl/history/${encodeURIComponent(r.s.season)}">${esc(r.s.label)}</a>${r.perfect ? ` ${PERFECT_MARK}` : ""}` },
      { label: "Place", key: (r) => -r.position, html: (r) => `<span class="muted">${ordinal(r.position)}</span>`, num: true },
      { label: "Stars", key: (r) => r.stars, html: (r) => `<b>${r.stars}</b> ${star}`, num: true },
      { label: "Destruction", key: (r) => r.destruction, html: (r) => `${num(r.destruction)}%`, num: true },
      { label: "Attacks", key: (r) => r.attacks, html: (r) => `${r.attacks}/${r.available}`, num: true },
    ], 0);
  }
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

// ---------------------------------------------------------------- shell
const TABS = [["overview", "Overview"], ["members", "Members"], ["war", "War"], ["cwl", "CWL"], ["streaks", "Streaks"], ["leaderboards", "Leaderboards"], ["raids", "Raids"]];

function route() {
  const [, page = "overview", a, b] = location.hash.split("/");
  const current = page === "player" ? "members" : page;
  document.querySelectorAll("#tabs a").forEach((t) => t.classList.toggle("on", t.dataset.tab === current));
  const render = {
    overview, members: membersPage, war: warPage, cwl: () => cwlPage(a, b), leaderboards: () => leaderboardsPage(a, b),
    streaks: () => streaksPage(a), raids: () => raidsPage(a), player: () => playerPage(decodeURIComponent(a || "")),
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
  document.getElementById("tabs").innerHTML = `<div class="in">${TABS.map(([k, v]) => `<a href="#/${k}" data-tab="${k}">${v}</a>`).join("")}</div>`;
  document.getElementById("foot").innerHTML = `<p>Updated ${ago(DATA.generated_at)}. Data from the Clash of Clans API, refreshed hourly by our clan bot.</p>
    <p>This content is not affiliated with, endorsed, sponsored, or specifically approved by Supercell and Supercell is not responsible for it.</p>`;
  window.addEventListener("hashchange", route);
  route();
}

main();
