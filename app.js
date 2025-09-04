// === FILL THESE IN ===
const ENDPOINT = "https://zjiangd-es06588.snowflakecomputing.com/api/v2/cortex/analyst/message";
const BEARER   = "Bearer eyJraWQiOiI1MDIyMjc2ODEzMyIsImFsZyI6IkVTMjU2In0.eyJwIjoiMTk2MTgyNTMyOjE5NjE4MjUzNiIsImlzcyI6IlNGOjIwMTgiLCJleHAiOjE3ODg1NDI4Mzl9.y9YOYb_R1nQDKEf0hYXTk0KszCzNV1gqHz7yhgXwkwz97ymxwDkbo-qh-sCjUlM1zEqkggf_JjmeFluwMqegEQ";   // demo only
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.INVENTORY_ANALYSIS"; // your FQN
// ===== FILL THESE IN (DEMO ONLY; tokens in client are risky) =====

// ===== Small helpers =====
const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };
const setAnswer = (msg) => { $("answer").textContent = msg; };

// Wait for the Extensions API to exist, then initialize
async function waitForTableauApi(timeoutMs = 8000) {
  const start = Date.now();
  while (typeof window.tableau === "undefined") {
    await new Promise(r => setTimeout(r, 100));
    if (Date.now() - start > timeoutMs) throw new Error("Tableau Extensions API not found.");
  }
}

async function initTableau() {
  // Initialize Tableau Extensions API only inside a Tableau dashboard
  await tableau.extensions.initializeAsync();
  return tableau.extensions.dashboardContent.dashboard;
}

// Collect filters from all worksheets as { fieldName: [values] }
async function collectDashboardFilters(dashboard) {
  const out = {};
  const sheets = dashboard.worksheets || [];
  for (const ws of sheets) {
    let filters = [];
    try { filters = await ws.getFiltersAsync(); } catch { /* ignore */ }
    for (const f of filters) {
      const key = f.fieldName || f.caption || "filter";
      if (!out[key]) out[key] = [];

      switch (f.filterType) {
        case "categorical": {
          const vals = (f.appliedValues || []).map(v => v.formattedValue ?? v.value);
          out[key] = Array.from(new Set(out[key].concat(vals)));
          break;
        }
        case "range": {
          out[key] = [{
            min: f.minValue ?? null,
            max: f.maxValue ?? null,
            includeNull: !!f.includeNullValues
          }];
          break;
        }
        case "relative-date": {
          out[key] = [{ period: f.periodType, rangeType: f.rangeType }];
          break;
        }
        default: {
          // Unsupported filter type; skip safely
        }
      }
    }
  }
  return out;
}

// Call Snowflake Cortex Analyst
async function callCortex(question, semanticView, filtersObj) {
  // You can prepend a grounding hint using filters if you want:
  // const hint = `Use these filters if relevant: ${JSON.stringify(filtersObj)}`;
  const body = {
    messages: [
      { role: "user", content: [{ type: "text", text: question }] }
    ],
    semantic_view: semanticView,
    stream: false
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": BEARER,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  // If CORS isn't allowed by Snowflake for your origin, this will throw.
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Cortex HTTP ${res.status}: ${txt || res.statusText}`);
  }

  // Analyst responses can vary; try common shapes:
  const data = await res.json();
  // v1: { message: { content: [ { text: "..." } ] }, sql: {...} }
  const answerFromV1 = data?.message?.content?.find?.(c => c?.type === "text")?.text;
  // alt: { answer: "..." }
  const answerFromAlt = data?.answer;
  const sqlMaybe = data?.message?.content?.find?.(c => c?.type === "sql")?.statement || data?.sql?.statement;

  return {
    answer: answerFromV1 || answerFromAlt || JSON.stringify(data, null, 2),
    sql: sqlMaybe || null,
    raw: data
  };
}

// Wire up the UI once the API is ready and initialized
(async function boot() {
  try {
    setStatus("Waiting for Tableau Extensions API…");
    await waitForTableauApi();
    setStatus("Initializing Tableau extension…");
    const dashboard = await initTableau();
    setStatus("Ready. Type a question and click Send.");

    $("send").addEventListener("click", async () => {
      const question = $("q").value.trim();
      if (!question) { setAnswer("Please type a question."); return; }

      setStatus("Collecting filters…");
      const filters = await collectDashboardFilters(dashboard);

      setStatus("Calling Snowflake Cortex Analyst…");
      try {
        const { answer, sql } = await callCortex(question, SEMANTIC_VIEW, filters);
        setAnswer(answer + (sql ? `\n\n---\nGenerated SQL:\n${sql}` : ""));
        setStatus("Done.");
      } catch (err) {
        setAnswer(`❌ Error calling Cortex:\n${(err && err.message) || err}`);
        setStatus("Failed.");
      }
    });
  } catch (err) {
    // If you're previewing index.html directly in a browser (NOT inside Tableau),
    // the Extensions API won't exist; you'll land here.
    setStatus("Not running inside Tableau (or Extensions API not available).");
    setAnswer(
      "Tip: Add this page as a Tableau dashboard extension via your .trex file.\n" +
      "If you are inside Tableau and still see this, ensure the Extensions API script\n" +
      "is loading and your extension host is safe-listed in Tableau Cloud."
    );
    console.error(err);
  }
})();
