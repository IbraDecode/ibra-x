/**
 * Dashboard Ibra X — satu halaman HTML tanpa build step dan tanpa aset
 * eksternal. Berkomunikasi dengan API lewat fetch dan SSE.
 *
 * Token API (bila diset) dibaca dari `?token=` atau localStorage, lalu dikirim
 * sebagai header `x-api-token` (fetch) dan query `token` (EventSource).
 */
export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ibra X — Dashboard</title>
<style>
  :root { color-scheme: dark; --bg:#0b0f14; --panel:#121821; --line:#1f2937; --fg:#e6edf3; --dim:#8b98a5; --acc:#4ade80; --warn:#fbbf24; --err:#f87171; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; letter-spacing:.3px; }
  header .badge { font-size:12px; color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }
  main { display:grid; grid-template-columns: repeat(auto-fit, minmax(320px,1fr)); gap:16px; padding:16px 20px; max-width:1400px; margin:0 auto; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  section h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0 0 10px; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; }
  .kv span:nth-child(odd) { color:var(--dim); }
  input, textarea, button { font:inherit; color:var(--fg); background:#0e141c; border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  button { cursor:pointer; background:#16202c; }
  button:hover { border-color:var(--acc); }
  .row { display:flex; gap:8px; margin-top:8px; }
  .row input { flex:1; }
  #events { font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; max-height:280px; overflow:auto; white-space:pre-wrap; }
  .ev-in { color:var(--acc); } .ev-out { color:#7dd3fc; } .ev-err { color:var(--err); } .ev-dim { color:var(--dim); }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font-size:12px; border:1px solid var(--line); border-radius:999px; padding:2px 10px; color:var(--dim); }
  .chip b { color:var(--fg); font-weight:600; }
  .pill { font-size:11px; border-radius:999px; padding:1px 8px; border:1px solid var(--line); }
  .risk-low { color:var(--acc); } .risk-medium { color:var(--warn); } .risk-high { color:var(--err); }
  #reply { margin-top:10px; white-space:pre-wrap; }
  .muted { color:var(--dim); }
</style>
</head>
<body>
<header>
  <h1>🧠 Ibra X</h1>
  <span class="badge" id="statusBadge">memuat…</span>
  <span class="badge" id="uptime"></span>
</header>
<main>
  <section>
    <h2>Status</h2>
    <div class="kv" id="status"></div>
  </section>

  <section>
    <h2>Akun WhatsApp</h2>
    <div class="chips" id="accounts"><span class="muted">—</span></div>
  </section>

  <section>
    <h2>Skill &amp; Tool</h2>
    <div id="skills" class="muted">—</div>
  </section>

  <section>
    <h2>Uji Agen</h2>
    <textarea id="chatInput" rows="3" placeholder="Tulis pesan untuk agen…" style="width:100%"></textarea>
    <div class="row">
      <input id="chatTarget" placeholder="chatId virtual (opsional)" />
      <button id="sendChat">Kirim</button>
    </div>
    <div id="reply" class="muted">Belum ada balasan.</div>
  </section>

  <section>
    <h2>Cari Memori</h2>
    <div class="row">
      <input id="memQuery" placeholder="kata kunci…" />
      <button id="searchMem">Cari</button>
    </div>
    <div id="memResults" class="muted" style="margin-top:10px"></div>
  </section>

  <section style="grid-column: 1 / -1;">
    <h2>Event Langsung</h2>
    <div id="events" class="muted">menunggu…</div>
  </section>
</main>

<script>
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || localStorage.getItem("ibrax_token") || "";
  if (params.get("token")) localStorage.setItem("ibrax_token", params.get("token"));

  const api = (path) => path + (token ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : "");
  const headers = () => (token ? { "x-api-token": token } : {});
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  async function jget(path) {
    const r = await fetch(api(path), { headers: headers() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function refresh() {
    try {
      const s = await jget("/api/status");
      el("statusBadge").textContent = s.provider + " · " + s.model;
      el("statusBadge").style.color = "var(--acc)";
      el("status").innerHTML = [
        ["Otonomi", s.autonomy],
        ["Provider", s.provider],
        ["Model", s.model],
        ["Skill", s.skills.length],
        ["Pesan", s.counts.messages],
        ["Memori", s.counts.memory],
      ].map(([k, v]) => '<span>' + esc(k) + '</span><span>' + esc(v) + '</span>').join("");
      el("uptime").textContent = "up " + Math.round(s.uptimeMs / 1000) + "s";

      el("accounts").innerHTML = s.accounts.length
        ? s.accounts.map((a) => '<span class="chip"><b>' + esc(a.id) + '</b> · ' + esc(a.role) + (a.enabled ? "" : " · nonaktif") + '</span>').join("")
        : '<span class="muted">belum ada akun</span>';

      el("skills").innerHTML = s.skills.map((sk) =>
        '<div style="margin-bottom:8px"><b>' + esc(sk.id) + '</b> <span class="muted">' + esc(sk.name) + '</span><div class="chips" style="margin-top:4px">' +
        sk.tools.map((t) => '<span class="chip">' + esc(t.name) + '</span>').join("") + '</div></div>').join("");
    } catch (e) {
      el("statusBadge").textContent = "error: " + e.message;
      el("statusBadge").style.color = "var(--err)";
    }
  }

  el("sendChat").onclick = async () => {
    const text = el("chatInput").value.trim();
    if (!text) return;
    el("reply").textContent = "…";
    try {
      const r = await fetch(api("/api/chat"), {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ text, chatId: el("chatTarget").value.trim() || undefined }),
      });
      const d = await r.json();
      el("reply").textContent = d.text || d.error || "(kosong)";
    } catch (e) {
      el("reply").textContent = "error: " + e.message;
    }
  };

  el("searchMem").onclick = async () => {
    const q = el("memQuery").value.trim();
    if (!q) return;
    try {
      const rows = await jget("/api/memory/search?q=" + encodeURIComponent(q));
      el("memResults").innerHTML = rows.length
        ? rows.map((r) => '<div>• <span class="muted">[' + esc(r.scope) + ']</span> ' + esc(r.text) + '</div>').join("")
        : '<span class="muted">tidak ada hasil</span>';
    } catch (e) {
      el("memResults").textContent = "error: " + e.message;
    }
  };

  const events = el("events");
  const es = new EventSource(api("/api/events"));
  const colors = { "inbound.message": "ev-in", "outbound.message": "ev-out", error: "ev-err" };
  ["inbound.message", "outbound.message", "agent.step", "agent.tool", "agent.finished", "account.status", "memory.written", "error"].forEach((name) => {
    es.addEventListener(name, (ev) => {
      if (events.textContent === "menunggu…") events.textContent = "";
      const line = document.createElement("div");
      line.className = colors[name] || "ev-dim";
      line.textContent = new Date().toLocaleTimeString() + "  " + name + "  " + ev.data;
      events.prepend(line);
      while (events.childElementCount > 200) events.lastChild.remove();
    });
  });
  es.onerror = () => { events.textContent = "koneksi event terputus; muat ulang bila perlu."; };

  refresh();
  setInterval(refresh, 10000);
</script>
</body>
</html>`
}
