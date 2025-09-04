// === CHANGE THESE TWO CONSTANTS ===
const FN_URL = "https://wonderful-kringle-00fe67.netlify.app/.netlify/functions/query";
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS";

const $ = id => document.getElementById(id);
const setStatus = t => $("status").textContent = t;

async function askCortex(q, filters = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, filters, semantic_view: SEMANTIC_VIEW })
  });
  return res.json();
}

(async () => {
  let dashboard = null;
  try {
    await tableau.extensions.initializeAsync();
    setStatus("Ready (Tableau filters enabled)");
    dashboard = tableau.extensions.dashboardContent.dashboard;
  } catch {
    setStatus("Ready (dev mode)");
  }

  $("send").onclick = async () => {
    const q = $("q").value.trim();
    if (!q) return;
    $("send").disabled = true;
    setStatus("Thinking…");

    const filters = {};
    if (dashboard) {
      for (const ws of dashboard.worksheets) {
        const fs = await ws.getFiltersAsync().catch(() => []);
        fs.filter(f => f.filterType === "categorical").forEach(f => {
          filters[f.fieldName] = f.appliedValues.map(v => v.formattedValue ?? v.value);
        });
      }
    }

    const data = await askCortex(q, filters);
    $("send").disabled = false;
    $("result-card").style.display = "";

    const md = data.response_metadata || {};
    $("badges").innerHTML = `
      <span class="badge">Model: ${md.model_names ? md.model_names.join(", ") : "–"}</span>
      <span class="badge">${md.is_semantic_sql ? "Semantic SQL" : "Freeform"}</span>
      <span class="badge">Latency: ${md.analyst_latency_ms ?? "–"} ms</span>
    `;

    const msg = data.message;
    const textObj = (msg?.content || []).find(c => c.type === "text");
    $("answer-text").textContent = textObj?.text || "No answer";

    const sqlObj = (msg?.content || []).find(c => c.type === "sql");
    if (sqlObj) {
      $("sql-text").textContent = sqlObj.text;
      $("sql-card").style.display = "";
    } else {
      $("sql-card").style.display = "none";
    }

    if (data.warnings?.length) {
      $("warning").style.display = "";
      $("warning").textContent = data.warnings.map(w => w.message || w).join("\n");
    } else {
      $("warning").style.display = "none";
    }

    setStatus("Done.");
  };
})();
