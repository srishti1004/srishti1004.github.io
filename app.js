(async () => {
  const $ = id => document.getElementById(id);
  const setStatus = msg => $("status").textContent = msg;
  const setAnswer = txt => $("answer").textContent = txt;

  try {
    await tableau.extensions.initializeAsync();
    setStatus("Ready. Ask a question.");
  } catch {
    setStatus("Load this as a Tableau extension.");
    return;
  }

  $("send").addEventListener("click", async () => {
    setStatus("Collecting filters...");
    const dash = tableau.extensions.dashboardContent.dashboard;
    const filters = {};
    await Promise.all(dash.worksheets.map(async ws => {
      const fs = await ws.getFiltersAsync().catch(() => []);
      fs.filter(f => f.filterType === "categorical").forEach(f => {
        filters[f.fieldName] = f.appliedValues.map(v => v.formattedValue ?? v.value);
      });
    }));

    const question = $("q").value.trim();
    if (!question) { setAnswer("Please enter a question."); return; }

    setStatus("Sending to proxy...");
    try {
      const res = await fetch("https://<your-middleware-site>.netlify.app/.netlify/functions/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, filters, semantic_view: "APP_DB.ANALYTICS.SALES_SV" })
      });
      const data = await res.json();
      setAnswer(data.answer || "No answer returned");
      setStatus("Done.");
    } catch (err) {
      setAnswer("Error: " + err);
      setStatus("Failed.");
    }
  });
})();
