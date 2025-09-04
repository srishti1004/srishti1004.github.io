// === FILL THESE IN ===
const ENDPOINT = "https://<account>.<region>.snowflakecomputing.com/api/v2/cortex/analyst/message";
const BEARER   = "Bearer <YOUR_ACCESS_TOKEN>";   // demo only
const SEMANTIC_VIEW = "APP_DB.ANALYTICS.SALES_SV"; // your FQN

async function tableauFiltersAsObject(dashboard) {
  const out = {};
  for (const ws of dashboard.worksheets) {
    const filters = await ws.getFiltersAsync().catch(() => []);
    for (const f of filters) {
      const key = f.fieldName || f.caption || "filter";
      if (!out[key]) out[key] = [];
      if (f.filterType === "categorical") {
        const vals = (f.appliedValues || []).map(v => v.formattedValue ?? v.value);
        out[key] = Array.from(new Set(out[key].concat(vals)));
      }
      // Add range/date handling here if you use those types
    }
  }
  return out;
}

async function init() {
  await tableau.extensions.initializeAsync(); // required
  const dash = tableau.extensions.dashboardContent.dashboard;

  document.getElementById("send").addEventListener("click", async () => {
    const question = document.getElementById("q").value.trim();
    if (!question) { document.getElementById("a").textContent = "Please type a question."; return; }

    const filters = await tableauFiltersAsObject(dash);
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: question }]}],
      semantic_view: SEMANTIC_VIEW,
      stream: false
    };

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Authorization": BEARER, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      // If CORS is not allowed by Snowflake, the browser will block here.
      const data = await res.json();
      const answer = (data?.message?.content?.[0]?.text) || data?.answer || JSON.stringify(data, null, 2);
      document.getElementById("a").textContent = answer;
    } catch (e) {
      document.getElementById("a").textContent = "Error calling Cortex: " + e;
    }
  });
}
init();
