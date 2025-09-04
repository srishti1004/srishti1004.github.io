// === CHANGE THESE TWO CONSTANTS ===
const FN_URL = "https://wonderful-kringle-00fe67.netlify.app/.netlify/functions/query";
const SEMANTIC_VIEW = "DEMO_INVENTORY.PUBLIC.SALES_SV";

const $ = (id) => document.getElementById(id);
const setStatus = (t) => $("status").textContent = t;
const setAnswer = (t) => $("answer").textContent = t;
const setHTML = (el, html) => { el.innerHTML = html; };

function safe(str) { return String(str ?? ""); }

// Try to initialize Tableau; fall back gracefully if running outside
async function initTableauIfAvailable() {
  try {
    if (window.tableau?.extensions) {
      await tableau.extensions.initializeAsync();
      setStatus("Ready. Filters will be captured from this dashboard.");
      return tableau.extensions.dashboardContent.dashboard;
    }
  } catch {}
  setStatus("Ready (dev mode). Running outside Tableau; no dashboard filters.");
  return null;
}

// Collect categorical filters as a simple object: { Field: [values] }
async function collectFilters(dashboard) {
  const out = {};
  if (!dashboard) return out;
  for (const ws of dashboard.worksheets || []) {
    let filters = [];
    try { filters = await ws.getFiltersAsync(); } catch {}
    for (const f of filters) {
      if (f.filterType === "categorical") {
        const vals = (f.appliedValues || []).map(v => v.formattedValue ?? v.value);
        if (!out[f.fieldName]) out[f.fieldName] = [];
        out[f.fieldName].push(...vals);
      }
    }
  }
  // De-duplicate arrays
  Object.keys(out).forEach(k => out[k] = [...new Set(out[k])]);
  return out;
}

// Render suggestions array into clickable chips
function renderSuggestions(arr) {
  const wrap = $("suggestions");
  wrap.innerHTML = "";
  if (!Array.isArray(arr) || !arr.length) return;
  arr.forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = s;
    chip.addEventListener("click", () => {
      $("q").value = s;
    });
    wrap.appendChild(chip);
  });
}

// Render warnings array (strings)
function renderWarnings(warnings) {
  const card = $("warnings-card");
  const box = $("warnings");
  if (!Array.isArray(warnings) || !warnings.length) {
    card.style.display = "none";
    box.innerHTML = "";
    return;
  }
  card.style.display = "";
  const list = warnings.map(w => `<div>• ${safe(w.message ?? w)}</div>`).join("");
  setHTML(box, list);
}

// Render metadata badges
function renderBadges(meta, topLevel) {
  const b = $("badges");
  b.innerHTML = "";
  // model names
  if (meta?.model_names?.length) {
    b.insertAdjacentHTML("beforeend", `<div class="badge">Model: ${meta.model_names.join(", ")}</div>`);
  }
  // semantic sql or not
  if (typeof meta?.is_semantic_sql === "boolean") {
    b.insertAdjacentHTML("beforeend", `<div class="badge">${meta.is_semantic_sql ? "Semantic SQL" : "Freeform / Non-SQL"}</div>`);
  }
  // question category
  if (topLevel?.question_category) {
    b.insertAdjacentHTML("beforeend", `<div class="badge">Category: ${safe(topLevel.question_category)}</div>`);
  }
  // latency
  if (meta?.analyst_latency_ms != null) {
    const ms = Number(meta.analyst_latency_ms);
    b.insertAdjacentHTML("beforeend", `<div class="badge">Latency: ${isFinite(ms) ? ms.toLocaleString() : ms} ms</div>`);
  }
}

// Render retrieval “evidence” cards
function renderEvidence(retrievalArr) {
  const card = $("evidence-card");
  const list = $("evidence-list");
  list.innerHTML = "";
  if (!Array.isArray(retrievalArr) || !retrievalArr.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  retrievalArr.forEach((r, i) => {
    const service = safe(r.service);
    const query = safe(r.query);
    const results = r.response_body?.results;
    const pretty = results ? JSON.stringify(results.slice(0,10), null, 2) : JSON.stringify(r.response_body ?? {}, null, 2);

    const html = `
      <details>
        <summary>${service}</summary>
        <div class="muted" style="margin:6px 0 8px;">Query: ${query}</div>
        <pre style="white-space:pre-wrap; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:10px;">${pretty}</pre>
      </details>
    `;
    list.insertAdjacentHTML("beforeend", html);
  });
}

// Extract main text + suggestions from the message content array
function parseMessageContent(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const textPiece = content.find(c => c?.type === "text")?.text;
  const suggestionsPiece = content.find(c => c?.type === "suggestions")?.suggestions;
  return { text: textPiece || "", suggestions: suggestionsPiece || [] };
}

// Send a question to your proxy
async function sendToProxy(question, filters) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      filters,
      semantic_view: SEMANTIC_VIEW
    })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

// Wire up UI
(async function boot() {
  const dashboard = await initTableauIfAvailable();

  $("send").addEventListener("click", async () => {
    const q = $("q").value.trim();
    if (!q) { setAnswer("Please enter a question."); return; }

    // UI state
    $("send").disabled = true; setStatus("Collecting filters…");
    const filters = await collectFilters(dashboard);

    try {
      setStatus("Querying Cortex Analyst…");
      const { status, data } = await sendToProxy(q, filters);

      // Handle errors
      if (status >= 400) {
        setAnswer(`❌ Error ${status}\n${typeof data === "object" ? JSON.stringify(data, null, 2) : data}`);
        renderSuggestions([]);
        renderWarnings([]);
        renderBadges({}, {});
        renderEvidence([]);
        return;
      }

      // Parse main message (your sample shape)
      const message = data?.message;
      const { text, suggestions } = parseMessageContent(message);

      setAnswer(text || "No text answer returned.");
      renderSuggestions(suggestions);

      // Warnings array (strings or objects with message)
      renderWarnings(data?.warnings);

      // Metadata badges
      renderBadges(data?.response_metadata, data);

      // Retrieval evidence
      renderEvidence(data?.response_metadata?.cortex_search_retrieval);

      setStatus("Done.");
    } catch (err) {
      setAnswer(`❌ ${err?.message || err}`);
      renderSuggestions([]);
      renderWarnings([]);
      renderBadges({}, {});
      renderEvidence([]);
      setStatus("Failed.");
    } finally {
      $("send").disabled = false;
    }
  });
})();
