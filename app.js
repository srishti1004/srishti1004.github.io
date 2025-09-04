// === CHANGE THESE TWO CONSTANTS ===
const FN_URL = "https://wonderful-kringle-00fe67.netlify.app/.netlify/functions/query";
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS";

const $ = id => document.getElementById(id);
const setStatus = t => $("status").textContent = t;

async function sendRequest(question, filters = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, filters, semantic_view: SEMANTIC_VIEW })
  });
  return res.json();
}

(async () => {
  let dashboard;
  try {
    await tableau.extensions.initializeAsync();
    setStatus("Ready using Tableau filters.");
    dashboard = tableau.extensions.dashboardContent.dashboard;
  } catch {
    setStatus("Ready (dev mode, no filters).");
  }

  $("send").onclick = async () => {
    const q = $("q").value.trim();
    if (!q) return alert("Please enter a question.");
    $("send").disabled = true;
    setStatus("Running...");

    // Optional: collect filters if in Tableau
    let filters = {};
    if (dashboard) {
      for (const ws of dashboard.worksheets) {
        try {
          const fs = await ws.getFiltersAsync();
          fs.filter(f => f.filterType === "categorical")
            .forEach(f => {
              filters[f.fieldName] = f.appliedValues.map(v => v.formattedValue ?? v.value);
            });
        } catch {}
      }
    }

    const data = await sendRequest(q, filters);
    $("send").disabled = false;

    $("result-card").style.display = "";
    $("badges").innerHTML = `
      <span class="badge">Model: ${data.response_metadata?.model_names.join(", ") ?? "–"}</span>
      <span class="badge">${data.response_metadata?.is_semantic_sql ? "Semantic SQL" : "Freeform"}</span>
      <span class="badge">Latency: ${data.response_metadata?.analyst_latency_ms} ms</span>
    `;

    const msg = data.message;
    let text = "";
    let sql = "";
    let tableData;

    if (msg?.content) {
      for (const c of msg.content) {
        if (c.type === "text") text = c.text;
        if (c.type === "sql") sql = c.text;
      }
    }

    setStatus("Done.");
    $("answer-text").textContent = text;

    if (sql) {
      $("sql-text").textContent = sql;
      $("sql-card").style.display = "";
    } else {
      $("sql-card").style.display = "none";
    }

    if (data.data) {
      const cols = Object.keys(data.data[0] || {});
      const table = document.createElement("table");
      const header = table.insertRow();
      cols.forEach(c => header.insertCell().textContent = c);
      data.data.forEach(r => {
        const row = table.insertRow();
        cols.forEach(c => row.insertCell().textContent = safe(r[c]));
      });
      const container = $("table-container");
      container.innerHTML = "";
      container.appendChild(table);
      $("table-card").style.display = "";
    } else {
      $("table-card").style.display = "none";
    }
  };
})();

// Utility
function safe(x) { return x == null ? "" : x; }
