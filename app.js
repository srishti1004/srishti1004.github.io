// === FILL THESE IN ===
const ENDPOINT = "https://zjiangd-es06588.snowflakecomputing.com/api/v2/cortex/analyst/message";
const token = process.env.SNOWFLAKE_PAT;  // correct retrieval
const BEARER = `Bearer ${token}`;         // correct interpolation
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS"; // your FQN
// ----- helpers -----
const $ = (id) => document.getElementById(id);
const setStatus = (m) => $("status").textContent = m;
const setAnswer = (m) => $("answer").textContent = m;

async function waitForTableauApi(timeoutMs = 8000) {
  const start = Date.now();
  while (typeof window.tableau === "undefined") {
    await new Promise(r => setTimeout(r, 100));
    if (Date.now() - start > timeoutMs) throw new Error("Extensions API not found");
  }
}

async function initTableau() {
  // Must run INSIDE a Tableau dashboard extension iframe
  // If you open index.html directly, this will fail (by design).
  await tableau.extensions.initializeAsync(); // create the extension context
  return tableau.extensions.dashboardContent.dashboard;
}

async function collectFilters(dashboard) {
  const out = {};
  for (const ws of (dashboard.worksheets || [])) {
    let filters = [];
    try { filters = await ws.getFiltersAsync(); } catch { /* ignore */ }
    for (const f of filters) {
      const key = f.fieldName || f.caption || "filter";
      if (!out[key]) out[key] = [];
      if (f.filterType === "categorical") {
        const vals = (f.appliedValues || []).map(v => v.formattedValue ?? v.value);
        out[key] = Array.from(new Set(out[key].concat(vals)));
      }
    }
  }
  return out;
}

async function callCortex(question, semanticView) {
  const body = {
    messages: [{ role: "user", content: [{ type: "text", text: question }] }],
    semantic_view: semanticView,
    stream: false
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Authorization": BEARER, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  const data = await res.json();
  const answer = data?.message?.content?.find?.(c => c?.type === "text")?.text
              || data?.answer
              || JSON.stringify(data, null, 2);
  const sql = data?.message?.content?.find?.(c => c?.type === "sql")?.statement
           || data?.sql?.statement || null;
  return { answer, sql };
}

(async function boot() {
  try {
    setStatus("Waiting for Extensions API…");
    await waitForTableauApi();                    // ensure API script loaded
    setStatus("Initializing extension…");
    const dashboard = await initTableau();        // ensure we're inside Tableau
    setStatus("Ready. Type a question and click Send.");

    document.getElementById("send").addEventListener("click", async () => {
      const q = $("q").value.trim();
      if (!q) { setAnswer("Please type a question."); return; }
      setStatus("Collecting filters…");
      const filters = await collectFilters(dashboard); // you can add them to the prompt if desired
      setStatus("Calling Cortex Analyst…");
      try {
        const { answer, sql } = await callCortex(q, SEMANTIC_VIEW);
        setAnswer(answer + (sql ? `\n\n---\nGenerated SQL:\n${sql}` : ""));
        setStatus("Done.");
      } catch (e) {
        setAnswer("❌ Cortex call failed:\n" + (e?.message || e));
        setStatus("Failed.");
      }
    });
  } catch (e) {
    // This fires if you opened index.html directly (not inside Tableau), or the API script failed to load.
    setStatus("Extensions API not available.");
    setAnswer(
      "Open this page as a Tableau Dashboard Extension via your .trex file.\n" +
      "In Tableau Cloud: Edit dashboard → drag Extension → Open from file → select your .trex\n"
    );
    console.error(e);
  }
})();
