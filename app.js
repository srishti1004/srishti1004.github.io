// === CHANGE THESE TWO CONSTANTS ===
const FN_URL = "https://wonderful-kringle-00fe67.netlify.app/.netlify/functions/query";
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS";

const $ = id => document.getElementById(id);
const setStatus = t => $("status").textContent = t;

async function showFilters(dashboard) {
  const display = $("filters-display");
  if (!dashboard) {
    display.textContent = "Filters: (not in Tableau)";
    return;
  }
  try {
    // Works in modern Extensions API (Tableau 2022.2+)
    // Returns all dashboard filters; then pick categorical ones.  🔗 docs
    const filters = await dashboard.getFiltersAsync() || [];
    const catFilters = filters.filter(f => f.filterType === tableau.FilterType.Categorical);
    if (!catFilters.length) {
      display.textContent = "Filters: (none applied)";
      return;
    }
    const lines = catFilters.map(f => {
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

function pickVizColumns(rows) {
  if (!rows || !rows.length) return null;
  const cols = Object.keys(rows[0]);
  // Heuristic: first string-like column for labels; first numeric column for values
  const numericCols = cols.filter(c => rows.some(r => typeof r[c] === "number" || (!isNaN(parseFloat(r[c])) && r[c] !== null && r[c] !== "")));
  const labelCol = cols.find(c => !numericCols.includes(c)) || cols[0];
  const valueCol = numericCols[0] || cols[1] || cols[0];
  return { labelCol, valueCol, cols };
}

function drawChart(rows) {
  const card = $("viz-card");
  const ctx = $("viz-canvas").getContext("2d");
  const picked = pickVizColumns(rows);
  if (!picked) { card.style.display = "none"; return; }

  const { labelCol, valueCol } = picked;
  const labels = rows.map(r => String(r[labelCol]));
  const values = rows.map(r => {
    const v = r[valueCol];
    const num = typeof v === "number" ? v : parseFloat(v);
    return isNaN(num) ? 0 : num;
  });

  if (window.__vizChart) {
    window.__vizChart.destroy();
  }
  window.__vizChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: `${valueCol} by ${labelCol}`,
        data: values
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { x: { ticks: { maxTicksLimit: 20 } } }
    }
  });

  card.style.display = "";
}

(async () => {
  let dashboard = null;
  try {
    await tableau.extensions.initializeAsync();
    dashboard = tableau.extensions.dashboardContent.dashboard;

    // Add FilterChanged listeners on **worksheets** (not dashboard).
    // Supported events per object: FilterChanged is on Worksheet. 🔗 docs
    for (const ws of dashboard.worksheets) {
      ws.addEventListener(
        tableau.TableauEventType.FilterChanged,
        async () => {
          await showFilters(dashboard);
          setStatus("Filters updated.");
        }
      );
    }

    await showFilters(dashboard);
    setStatus("Ready using Tableau filters.");
  } catch (e) {
    console.warn("Running outside Tableau or initialization failed:", e);
    setStatus("Ready (dev mode, no filters).");
  }

  $("send").onclick = async () => {
    const q = $("q").value.trim();
    if (!q) return alert("Please enter a question.");

    $("send").disabled = true;
    setStatus("Running...");
    const t0 = performance.now();

    // Collect dashboard filters once (categorical only)
    let filters = {};
    try { filters = await collectFilters(dashboard); } catch {}

    try {
      const data = await sendRequest(q, filters);
      const t1 = performance.now();

      $("send").disabled = false;
      setStatus("Done.");
      $("result-card").style.display = "";

      // === badges ===
      const isSemantic = Array.isArray(data?.message?.content) &&
                         data.message.content.some(c => c.type === "sql");
      const modelNames = data?.response_metadata?.model_names?.join(", ") || "–";
      const latencyMs = Math.round(t1 - t0);

      $("badges").innerHTML = `
        <span class="badge">Model: ${modelNames}</span>
        <span class="badge">${isSemantic ? "Semantic SQL" : "Freeform"}</span>
        <span class="badge">Latency: ${latencyMs} ms</span>
      `;

      // === answer text ===
      const textPiece = Array.isArray(data?.message?.content)
        ? (data.message.content.find(c => c.type === "text")?.text || "")
        : "";
      $("answer-text").textContent = textPiece || "No answer returned.";

      // === SQL ===
      const sqlPiece = Array.isArray(data?.message?.content)
        ? (data.message.content.find(c => c.type === "sql")?.statement ||
           data.message.content.find(c => c.type === "sql")?.text || "")
        : "";
      if (sqlPiece) {
        $("sql-text").textContent = sqlPiece;
        $("sql-card").style.display = "";
      } else {
        $("sql-card").style.display = "none";
      }

      // === Results table ===
      const rows = Array.isArray(data.query_results) ? data.query_results : [];
      if (rows.length > 0) {
        const cols = data.query_columns && data.query_columns.length
          ? data.query_columns
          : Object.keys(rows[0]);

        const table = document.createElement("table");
        const thead = table.createTHead().insertRow();
        cols.forEach(c => {
          const th = document.createElement("th");
          th.textContent = c;
          thead.appendChild(th);
        });
        const tbody = table.createTBody();
        rows.forEach(row => {
          const tr = tbody.insertRow();
          cols.forEach(c => tr.insertCell().textContent = (row[c] ?? "").toString());
        });
        $("table-container").innerHTML = "";
        $("table-container").appendChild(table);
        $("table-card").style.display = "";

        // === Visualization (in-extension chart) ===
        drawChart(rows);
      } else {
        $("table-card").style.display = "none";
        $("viz-card").style.display = "none";
      }

    } catch (err) {
      $("send").disabled = false;
      setStatus("Failed.");
      $("result-card").style.display = "";
      $("answer-text").textContent = "❌ " + (err.message || err);
      $("sql-card").style.display = "none";
      $("table-card").style.display = "none";
      $("viz-card").style.display = "none";
      console.error(err);
    }
  };
})();
