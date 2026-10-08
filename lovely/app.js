// Lovely clan mini site. Reads data.json (rebuilt hourly by the clan bot) and renders
// everything client-side with hash routes: #/overview, #/members, #/war, #/cwl,
// #/cwl/<round>, #/leaderboards, #/raids, #/player/<tag>.
"use strict";

let DATA = null;
const DISCORD_INVITE = "https://discord.gg/8wmVTaMsVR";

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
const ROLES = { leader: "Leader", coLeader: "Co-leader", admin: "Elder", member: "Member" };
const ROLE_ORDER = { leader: 0, coLeader: 1, admin: 2, member: 3 };
const RESULT = { W: "WIN", L: "LOSS", T: "TIE", inWar: "LIVE", preparation: "PREP" };
const playerLink = (tag, name) => `<a href="#/player/${encodeURIComponent(tag)}">${esc(name)}</a>`;
const tile = (value, label, cls = "") => `<div class="tile"><b class="${cls}">${value}</b><span>${esc(label)}</span></div>`;

function result(r) {
  if (r.state !== "warEnded") return ["preparation", "inWar"].includes(r.state) ? r.state : "";
  const a = [r.stars[0], r.pct[0]], b = [r.stars[1], r.pct[1]];
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? "W" : a[0] === b[0] && a[1] === b[1] ? "T" : "L";
}

// A sortable table: columns = [{label, key(row) -> sort value, html(row), num}]
function table(rows, columns, sortKey = null, sortDir = -1) {
  const id = `t${Math.random().toString(36).slice(2)}`;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    let state = { col: sortKey, dir: sortDir };
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
        .map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(r)}</td>`).join("")}</tr>`)
        .join("");
    };
    el.querySelectorAll("th").forEach((h, i) =>
      h.addEventListener("click", () => {
        if (!columns[i].key) return;
        state = { col: i, dir: state.col === i ? -state.dir : -1 };
        draw();
      })
    );
    draw();
  });
  return `<div class="panel"><table id="${id}"><thead><tr>${columns
    .map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`)
    .join("")}</tr></thead><tbody></tbody></table></div>`;
}

// ---------------------------------------------------------------- pages
function overview() {
  const c = DATA.clan, w = DATA.war, cwl = DATA.cwl;
  const war3 = DATA.members.filter((m) => m.war.all.attacks >= 3).sort((a, b) => b.war.all.triples / b.war.all.attacks - a.war.all.triples / a.war.all.attacks || b.war.all.attacks - a.war.all.attacks).slice(0, 5);
  const donors = [...DATA.members].sort((a, b) => b.donations - a.donations).slice(0, 5);
  let html = `<div class="tiles">
    ${tile(esc(c.war_league || "-"), "war league")}
    ${tile(num(c.win_streak), "war win streak", "gold")}
    ${tile(`${num(c.record[0])}–${num(c.record[1])}–${num(c.record[2])}`, "wins · ties · losses")}
    ${tile(esc(c.capital_league || "-"), "capital league")}
    ${tile(`${num(c.members)}/50`, "members")}
    ${tile(`TH${num(c.required_th)}+`, c.type === "inviteOnly" ? "invite only" : c.type || "")}
  </div>`;
  if (c.description) html += `<p class="muted">${esc(c.description)}</p>`;
  if (c.labels.length) html += `<div class="labels">${c.labels.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
  if (w) html += `<h2>Current war</h2><a href="#/war" class="panel score" style="display:block">${scoreHtml(w)}</a>`;
  if (cwl) html += `<h2>CWL ${seasonName(cwl.season)}</h2><div class="tiles">${tile(`#${num(cwl.position)} of ${num(cwl.clans)}`, "group position", "gold")}${tile(`${num(cwl.stars)} ${star}`, "stars")}${tile(num(Math.round(cwl.destruction)), "destruction")}</div>`;
  html += `<h2>Top 3-star rate</h2>${rankList(war3.map((m) => [m, pct(m.war.all.triples / m.war.all.attacks), `${m.war.all.attacks} attacks`]))}`;
  html += `<h2>Top donors this season</h2>${rankList(donors.map((m) => [m, num(m.donations), `received ${num(m.received)}`]))}`;
  return html;
}

function scoreHtml(w) {
  const status = { preparation: `preparation · battle starts in ${until(w.start)}`, inWar: `battle day · ends in ${until(w.end)}`, warEnded: `ended ${ago(w.end)}` }[w.state];
  return `<div class="muted">${w.kind === "cwl" ? `CWL round ${w.round}` : "Clan war"} · ${esc(status)}</div>
    <div class="big">${star} ${w.us.stars}<span class="vs">–</span>${w.them.stars} ${star}</div>
    <div><b>${esc(w.us.name)}</b> <span class="muted">vs</span> <b>${esc(w.them.name)}</b></div>
    <div class="muted">${w.us.pct.toFixed(1)}% – ${w.them.pct.toFixed(1)}% · attacks ${w.us.used}/${w.us.total} – ${w.them.used}/${w.them.total}</div>`;
}

function rankList(items) {
  if (!items.length) return `<p class="muted">Nothing recorded yet.</p>`;
  return `<div class="panel"><table><tbody>${items
    .map(([m, value, detail], i) => `<tr><td><span class="rank r${i + 1}">${i + 1}</span> ${th(m.th)} ${playerLink(m.tag, m.name)}</td><td class="num muted">${esc(detail)}</td><td class="num gold"><b>${value}</b></td></tr>`)
    .join("")}</tbody></table></div>`;
}

function lineupTable(lineup, pending) {
  return table(lineup, [
    { label: "#", key: (m) => m.pos, html: (m) => `<span class="muted">${m.pos}</span>` },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => `${th(m.th)} ${playerLink(m.tag, m.name)}` },
    {
      label: "Attacks", key: (m) => m.attacks.reduce((s, a) => s + a.stars, 0),
      html: (m) => (m.attacks.length ? m.attacks.map((a) => `→ #${a.pos ?? "?"} ${th(a.th, "small")} ${stars(a.stars)} <b class="${a.pct >= 100 ? "gold" : ""}">${Math.round(a.pct)}%</b>`).join("<br>") : `<span class="muted">${pending}</span>`),
    },
    {
      label: "Defense", key: (m) => -m.defense.stars,
      html: (m) => (m.defense.n ? `<span class="def ${m.defense.stars < 3 ? "win" : "loss"}">${stars(m.defense.stars)} ${Math.round(m.defense.pct)}%${m.defense.n > 1 ? ` · ${m.defense.n}x` : ""}</span>` : `<span class="muted def">not attacked</span>`),
    },
  ], 0, 1);  // map position, top first
}

function warPage() {
  const w = DATA.war;
  if (!w) return `<p class="muted center">No war right now.</p>`;
  const left = w.lineup.filter((m) => m.attacks.length < w.per);
  const hit = w.lineup.filter((m) => m.defense.n), held = hit.filter((m) => m.defense.stars < 3);
  let html = `<div class="panel score">${scoreHtml(w)}</div>`;
  if (w.state === "preparation") return html + `<p class="muted center">Preparation day: attacks start in ${until(w.start)}.</p>`;
  html += `<div class="tiles" style="margin-top:8px">${tile(num(w.us.total - w.us.used), "our attacks left", "gold")}${tile(hit.length ? `${held.length}/${hit.length}` : "–", "bases held", "win")}${tile(w.them.total - w.them.used, "enemy attacks left")}</div>`;
  if (left.length && w.state === "inWar") html += `<h3>Still to attack (${left.length})</h3><div class="labels">${left.map((m) => `<span>${th(m.th, "small")} ${esc(m.name)}</span>`).join("")}</div>`;
  return html + `<h2>Line-up</h2>${lineupTable(w.lineup, w.state === "inWar" ? "no attack yet" : "no attack")}`;
}

function seasonName(s) {
  const [y, m] = (s || "").split("-");
  return m ? new Date(+y, +m - 1).toLocaleString(undefined, { month: "long", year: "numeric" }) : esc(s);
}

function cwlPage(roundNo) {
  const c = DATA.cwl;
  if (!c) return `<p class="muted center">No CWL data yet.</p>`;
  if (roundNo) {
    const r = c.rounds.find((x) => x.round === +roundNo);
    if (!r) return `<p class="muted">No such round.</p>`;
    const res = result(r);
    return `<p><a href="#/cwl" class="muted">← CWL ${seasonName(c.season)}</a></p>
      <div class="panel score"><div><span class="chip ${res}">${RESULT[res]}</span> Round ${r.round} vs <b>${esc(r.opponent)}</b></div>
      <div class="big">${star} ${r.stars[0]}<span class="vs">–</span>${r.stars[1]} ${star}</div>
      <div class="muted">${r.pct[0].toFixed(1)}% – ${r.pct[1].toFixed(1)}%</div></div>
      <h2>Line-up</h2>${lineupTable(r.lineup, r.state === "inWar" ? "no attack yet" : "no attack")}`;
  }
  let html = `<div class="tiles">${tile(`#${num(c.position)} of ${num(c.clans)}`, "group position", "gold")}${tile(`${num(c.stars)} ${star}`, "stars")}${tile(num(Math.round(c.destruction)), "destruction")}</div>`;
  html += `<h2>Our rounds</h2><div class="panel rounds">${c.rounds
    .map((r) => { const res = result(r); return `<a href="#/cwl/${r.round}"><b>R${r.round}</b><span class="chip ${res}">${RESULT[res]}</span><span class="opp">${esc(r.opponent)}</span><b>${r.stars[0]} – ${r.stars[1]}</b><span class="muted">${Math.round(r.pct[0])}% – ${Math.round(r.pct[1])}%</span></a>`; })
    .join("")}</div>`;
  html += `<h2>Members</h2><p class="muted">Finished rounds only, like the in-game Clan tab.</p>` + table(c.members, [
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => playerLink(m.tag, m.name) },
    { label: "Stars", key: (m) => m.stars, html: (m) => `<b>${m.stars}</b> ${star}`, num: true },
    { label: "Destruction", key: (m) => m.destruction, html: (m) => num(Math.round(m.destruction)), num: true },
    { label: "Attacks", key: (m) => m.attacks, html: (m) => `${m.attacks}/${m.wars}`, num: true },
  ], 1);
  return html;
}

function membersPage() {
  return table(DATA.members, [
    { label: "TH", key: (m) => m.th, html: (m) => th(m.th) },
    { label: "Member", key: (m) => m.name.toLowerCase(), html: (m) => playerLink(m.tag, m.name) },
    { label: "Role", key: (m) => -ROLE_ORDER[m.role], html: (m) => (m.role === "member" ? `<span class="muted">Member</span>` : `<span class="chip ${m.role === "leader" ? "leader" : m.role === "admin" ? "admin" : "role"}">${ROLES[m.role]}</span>`) },
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
  const [label, value, fmt, detail] = METRICS[metric];
  let rows;
  if (metric === "donations") rows = DATA.members.map((m) => [m, m.donations, `received ${num(m.received)}`]);
  else if (metric === "donations_total") rows = DATA.members.filter((m) => m.donations_total != null).map((m) => [m, m.donations_total, `received ${num(m.received_total)}`]);
  else rows = DATA.members.map((m) => [m, value(m.war[scope], m.defense[scope]), detail(m.war[scope], m.defense[scope])]).filter((r) => r[1] !== false && r[1] !== 0);
  rows.sort((a, b) => b[1] - a[1]);
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join("");
  setTimeout(() => {
    const go = () => { location.hash = `#/leaderboards/${document.getElementById("metric").value}/${document.getElementById("scope").value}`; };
    document.getElementById("metric").onchange = go;
    document.getElementById("scope").onchange = go;
  });
  return `<p><select id="metric">${opts(METRICS, metric)}</select><select id="scope" ${metric.startsWith("donations") ? "disabled" : ""}>${opts({ all: "All wars", cwl: "CWL", regular: "Regular wars" }, scope)}</select></p>
    <h2>${esc(label)}</h2>${rankList(rows.slice(0, 25).map(([m, v, d]) => [m, fmt(v), d]))}
    <p class="muted">Rates and averages need at least 3 attacks (or defenses). War stats come from wars the bot has recorded.</p>`;
}

function raidsPage(index = 0) {
  if (!DATA.raids.length) return `<p class="muted center">No raid weekends yet.</p>`;
  const r = DATA.raids[index], raided = new Set(r.members.map((m) => m.tag));
  const missing = DATA.members.filter((m) => !raided.has(m.tag));
  setTimeout(() => { document.getElementById("weekend").onchange = (e) => { location.hash = `#/raids/${e.target.value}`; }; });
  return `<p><select id="weekend">${DATA.raids.map((x, i) => `<option value="${i}" ${i === +index ? "selected" : ""}>Weekend of ${when(x.start, { month: "long", day: "numeric" })}</option>`).join("")}</select>
    <span class="muted">${r.state === "ongoing" ? `ends in ${until(r.end)}` : "ended"}</span></p>
    <div class="tiles">${tile(num(r.loot), "capital gold", "gold")}${tile(num(r.raids), "raids completed")}${tile(num(r.districts), "districts destroyed")}${tile(r.attacks, "attacks")}${tile(r.members.length, "raiders")}${tile(num(r.medals), "medals")}</div>
    <h2>Raiders</h2>${r.members.length ? table(r.members, [
      { label: "Raider", key: (m) => m.name.toLowerCase(), html: (m) => playerLink(m.tag, m.name) },
      { label: "Attacks", key: (m) => m.attacks, html: (m) => `${m.attacks}/${m.limit}`, num: true },
      { label: "Capital gold", key: (m) => m.loot, html: (m) => `<b>${num(m.loot)}</b>`, num: true },
    ], 2) : `<p class="muted">Nobody raided.</p>`}
    <h2>Didn't raid (${missing.length})</h2><div class="labels">${missing.map((m) => `<span>${esc(m.name)}</span>`).join("")}</div>`;
}

function playerPage(tag) {
  const m = DATA.members.find((x) => x.tag === tag);
  if (!m) return `<p class="muted center">That player isn't in the clan right now.</p>`;
  let html = `<div style="display:flex;align-items:center;gap:14px">${th(m.th).replace('class="th', 'style="width:64px;height:64px" class="th')}
    <div><h2 style="margin:0">${esc(m.name)}</h2><div class="muted">${ROLES[m.role]} · ${esc(m.tag)} · ${esc(m.league || "Unranked")}</div></div></div>`;
  html += `<div class="tiles" style="margin-top:14px">${tile(num(m.donations), "donated this season", "gold")}${tile(num(m.received), "received this season")}${m.donations_total != null ? tile(num(m.donations_total), `donated since ${when(m.tracked_since)}`) : ""}</div>`;
  for (const [scope, name] of [["all", "All wars"], ["cwl", "CWL"], ["regular", "Regular wars"]]) {
    const s = m.war[scope], d = m.defense[scope];
    if (!s.attacks && !d.attacked) continue;
    html += `<h3>${name}</h3><div class="tiles">${tile(s.attacks ? pct(s.triples / s.attacks) : "–", "3-star rate", "gold")}${tile(num(s.attacks), "attacks")}${tile(s.avg_stars.toFixed(2), "avg stars")}${tile(`${Math.round(s.avg_destruction)}%`, "avg destruction")}${tile(s.missed, "missed", s.missed ? "loss" : "")}
      ${d.attacked ? tile(pct(d.held / d.attacked), "defenses held", d.held * 2 >= d.attacked ? "win" : "loss") + tile(num(d.attacked), "times attacked") + tile(d.avg_stars.toFixed(2), "stars allowed") : ""}</div>`;
  }
  if (m.recent.length) {
    html += `<h2>Recent attacks</h2>` + table(m.recent, [
      { label: "Result", key: null, html: (a) => `${stars(a.stars)} <b>${Math.round(a.pct)}%</b>` },
      { label: "Target", key: null, html: (a) => (a.pos ? `#${a.pos} ${th(a.th, "small")}` : "?") },
      { label: "War", key: null, html: (a) => `<span class="muted">${a.kind === "cwl" ? `CWL R${a.round}` : "War"} vs</span> ${esc(a.opponent)}` },
      { label: "Date", key: null, html: (a) => `<span class="muted">${when(a.start)}</span>`, num: true },
    ]);
  }
  return html;
}

// ---------------------------------------------------------------- shell
const TABS = [["overview", "Overview"], ["members", "Members"], ["war", "War"], ["cwl", "CWL"], ["leaderboards", "Leaderboards"], ["raids", "Raids"]];

function route() {
  const [, page = "overview", a, b] = location.hash.split("/");
  document.getElementById("tabs").innerHTML = TABS.map(([k, v]) => `<a href="#/${k}" class="${k === page || (page === "player" && k === "members") ? "on" : ""}">${v}</a>`).join("");
  const render = { overview, members: membersPage, war: warPage, cwl: () => cwlPage(a), leaderboards: () => leaderboardsPage(a, b), raids: () => raidsPage(a), player: () => playerPage(decodeURIComponent(a || "")) }[page] || overview;
  document.getElementById("page").innerHTML = render();
  window.scrollTo(0, 0);
}

async function main() {
  try {
    DATA = await (await fetch(`data.json?v=${Math.floor(Date.now() / 600000)}`)).json();
  } catch (e) {
    document.getElementById("page").innerHTML = `<p class="muted center">Couldn't load the clan data.</p>`;
    return;
  }
  const c = DATA.clan;
  document.getElementById("top").innerHTML = `${c.badge ? `<img class="badge" src="${esc(c.badge)}" alt="">` : ""}
    <div><h1>${esc(c.name)}</h1><div class="sub">${esc(c.tag)} · level ${c.level} · ${esc(c.war_league || "")} · ${num(c.win_streak)}-war win streak</div></div>
    <a class="join" href="${DISCORD_INVITE}" target="_blank" rel="noopener">Join our Discord</a>`;
  document.getElementById("foot").innerHTML = `Updated ${ago(DATA.generated_at)} · data from the Clash of Clans API, refreshed hourly.<br>
    This content is not affiliated with, endorsed, sponsored, or specifically approved by Supercell and Supercell is not responsible for it.`;
  window.addEventListener("hashchange", route);
  route();
}

main();
