// === CHANGE THESE CONSTANTS ===
const FN_URL = "https://wonderful-kringle-00fe67.netlify.app/.netlify/functions/query";
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS";

// Name (or unique substring) of the datasource that powers your worksheet
const RESULTS_DATASOURCE_MATCH = "CORTEX_RESULT_POINTS"; // adjust to your DS name
const RUN_ID_PARAMETER = "RUN_ID";

const $ = id => document.getElementById(id);
const setStatus = t => $("status").textContent = t;

async function showFilters(dashboard) {
  const display = $("filters-display");
  if (!dashboard) {
    display.textContent = "Filters: (not in Tableau)";
    return;
  }
  try {
    const filters = await dashboard.getFiltersAsync() || [];
    const cat = filters.filter(f => f.filterType === tableau.FilterType.Categorical);
    if (!cat.length) { display.textContent = "Filters: (none applied)"; return; }
    const lines = cat.map(f => {
      const vals = (f.appliedValues || []).map(v => v.formattedValue ?? v.value).join(", ");
      return `${f.fieldName}: [${vals}]`;
    });
    display.textContent = "Filters: " + lines.join(" | ");
  } catch (err) {
    display.textContent = "Filters: (error retrieving)";
    console.error(err);
  }
}

async function collectFilters(dashboard) {
  if (!dashboard) return {};
  const filters = await dashboard.getFiltersAsync();
  const cat = (filters || []).filter(f => f.filterType === tableau.FilterType.Categorical);
  const out = {};
  for (const f of cat) {
    out[f.fieldName] = (f.appliedValues || []).map(v => v.formattedValue ?? v.value);
  }
  return out;
}

async function sendRequest(question, filters = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, filters, semantic_view: SEMANTIC_VIEW })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function setRunIdParameter(dashboard, runId) {
  if (!dashboard || !runId) return;
  const params = await dashboard.getParametersAsync();
  const p = params.find(x => x.name === RUN_ID_PARAMETER);
  if (p) {
    // changeValueAsync updates a Tableau parameter from an extension
    await p.changeValueAsync(runId); // documented in Parameter interface
  }
}

async function refreshResultsDataSource(dashboard) {
  if (!dashboard) return;
  // getDataSourcesAsync and refreshAsync are supported; use on user action only
  const seen = new Set();
  for (const ws of dashboard.worksheets) {
    const dss = await ws.getDataSourcesAsync();
    for (const ds of dss) {
      if (seen.has(ds.id)) continue;
      seen.add(ds.id);
      if (!RESULTS_DATASOURCE_MATCH || ds.name.includes(RESULTS_DATASOURCE_MATCH)) {
        try { await ds.refreshAsync(); } catch (e) { console.warn("refresh failed:", ds.name, e); }
      }
    }
  }
}

(async () => {
  let dashboard = null;
  try {
    await tableau.extensions.initializeAsync();
    dashboard = tableau.extensions.dashboardContent.dashboard;

    // Listen for filter changes on each worksheet (FilterChanged is a worksheet event)
    for (const ws of dashboard.worksheets) {
      ws.addEventListener(
        tableau.TableauEventType.FilterChanged,
        async () => { await showFilters(dashboard); setStatus("Filters updated."); }
      );
    }
    await showFilters(dashboard);
    setStatus("Ready using Tableau filters.");
  } catch (e) {
    console.warn("Running outside Tableau:", e);
    setStatus("Ready (dev mode, no filters).");
  }

  $("send").onclick = async () => {
    const q = $("q").value.trim();
    if (!q) return alert("Please enter a question.");

    $("send").disabled = true;
    setStatus("Running...");
    const t0 = performance.now();

    let filters = {};
    try { filters = await collectFilters(dashboard); } catch {}

    try {
      const data = await sendRequest(q, filters);
      const t1 = performance.now();

      $("send").disabled = false;
      setStatus("Done.");
      $("result-card").style.display = "";

      // Badges
      const isSemantic = Array.isArray(data?.message?.content) &&
                         data.message.content.some(c => c.type === "sql");
      const modelNames = data?.response_metadata?.model_names?.join(", ") || "–";
      const latencyMs = Math.round(t1 - t0);
      $("badges").innerHTML = `
        <span class="badge">Model: ${modelNames}</span>
        <span class="badge">${isSemantic ? "Semantic SQL" : "Freeform"}</span>
        <span class="badge">Latency: ${latencyMs} ms</span>
      `;

      // Answer text
      const textPiece = Array.isArray(data?.message?.content)
        ? (data.message.content.find(c => c.type === "text")?.text || "")
        : "";
      $("answer-text").textContent = textPiece || "No answer returned.";

      // SQL block
      const sqlPiece = Array.isArray(data?.message?.content)
        ? (data.message.content.find(c => c.type === "sql")?.statement ||
           data.message.content.find(c => c.type === "sql")?.text || "")
        : "";
      if (sqlPiece) { $("sql-text").textContent = sqlPiece; $("sql-card").style.display = ""; }
      else { $("sql-card").style.display = "none"; }

      // Results table (for debugging / inspection)
      const rows = Array.isArray(data.query_results) ? data.query_results : [];
      if (rows.length) {
        const cols = data.query_columns?.length ? data.query_columns : Object.keys(rows[0]);
        const table = document.createElement("table");
        const thead = table.createTHead().insertRow();
        cols.forEach(c => { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); });
        const tbody = table.createTBody();
        rows.forEach(r => {
          const tr = tbody.insertRow();
          cols.forEach(c => tr.insertCell().textContent = (r[c] ?? "").toString());
        });
        $("table-container").innerHTML = "";
        $("table-container").appendChild(table);
        $("table-card").style.display = "";
      } else {
        $("table-card").style.display = "none";
      }

      // === CRITICAL: Drive the native Tableau viz ===
      if (dashboard && data.run_id) {
        await setRunIdParameter(dashboard, data.run_id);           // set RUN_ID param
        await refreshResultsDataSource(dashboard);                  // refresh datasource -> sheet redraws
      }

    } catch (err) {
      $("send").disabled = false;
      setStatus("Failed.");
      $("result-card").style.display = "";
      $("answer-text").textContent = "❌ " + (err.message || err);
      $("sql-card").style.display = "none";
      $("table-card").style.display = "none";
      console.error(err);
    }
  };
})();
