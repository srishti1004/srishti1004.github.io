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
    const filters = await dashboard.getFiltersAsync() || [];
    const catFilters = filters.filter(f => f.filterType === tableau.FilterType.Categorical);
    console.log(filters);
    if (!catFilters.length) {
      display.textContent = "Filters: (none applied)";
      return;
    }

    const lines = catFilters.map(f => {
      const vals = f.appliedValues.map(v => v.formattedValue ?? v.value).join(", ");
      return `${f.fieldName}: [${vals}]`;
    });
    display.textContent = "Filters: " + lines.join(" | ");
  } catch (err) {
    display.textContent = "Filters: (error retrieving)";
    console.error(err);
  }
}
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
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    
    dashboard.addEventListener(
      tableau.TableauEventType.FilterChanged,
      async (filterEvent) => {
        await showFilters(dashboard);
        setStatus("Filters updated.");
      }
    );
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

    // Collect filters if inside Tableau
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

    try {
      const data = await sendRequest(q, filters);
      $("send").disabled = false;
      setStatus("Done.");
      $("result-card").style.display = "";

      // === badges ===
      $("badges").innerHTML = `
        <span class="badge">Model: ${data.response_metadata?.model_names?.join(", ") ?? "–"}</span>
        <span class="badge">${data.response_metadata?.is_semantic_sql ? "Semantic SQL" : "Freeform"}</span>
        <span class="badge">Latency: ${data.response_metadata?.analyst_latency_ms ?? "–"} ms</span>
      `;

      // === answer text ===
      const msg = data.message;
      const textPiece = Array.isArray(msg?.content)
        ? msg.content.find(c => c.type === "text")?.text
        : "";
      $("answer-text").textContent = textPiece || "No answer returned.";

      // === SQL ===
      const sqlPiece = Array.isArray(msg?.content)
        ? msg.content.find(c => c.type === "sql")?.statement ||
          msg.content.find(c => c.type === "sql")?.text
        : "";
      if (sqlPiece) {
        $("sql-text").textContent = sqlPiece;
        $("sql-card").style.display = "";
      } else {
        $("sql-card").style.display = "none";
      }

      // === Results table (from middleware) ===
      // middleware should attach executed rows under `query_results`
      if (Array.isArray(data.query_results) && data.query_results.length > 0) {
        const cols = Object.keys(data.query_results[0]);
        const table = document.createElement("table");
        const thead = table.createTHead().insertRow();
        cols.forEach(c => thead.insertCell().textContent = c);
        const tbody = table.createTBody();
        data.query_results.forEach(row => {
          const tr = tbody.insertRow();
          cols.forEach(c => tr.insertCell().textContent = row[c] ?? "");
        });
        $("table-container").innerHTML = "";
        $("table-container").appendChild(table);
        $("table-card").style.display = "";
      } else {
        $("table-card").style.display = "none";
      }

    } catch (err) {
      $("send").disabled = false;
      setStatus("Failed.");
      $("result-card").style.display = "";
      $("answer-text").textContent = "❌ " + (err.message || err);
      $("sql-card").style.display = "none";
      $("table-card").style.display = "none";
    }
  };
})();
