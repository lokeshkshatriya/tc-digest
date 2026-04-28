function verdictColor(score) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function formatTime(isoString) {
  if (!isoString) return "--";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function setStatus(text) {
  document.getElementById("status").textContent = text || "";
}

function renderFlags(flags) {
  const list = document.getElementById("flags");
  list.innerHTML = "";
  if (!Array.isArray(flags) || flags.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No major red flags detected.";
    list.appendChild(li);
    return;
  }

  flags.slice(0, 6).forEach((flag) => {
    const li = document.createElement("li");
    li.textContent = flag;
    list.appendChild(li);
  });
}

function renderAnalysis(domain, analysis) {
  document.getElementById("site").textContent = `Site: ${domain}`;
  const scoreEl = document.getElementById("score");
  const spinnerEl = document.getElementById("spinner");

  if (!analysis) {
    scoreEl.style.display = "none";
    spinnerEl.classList.add("active");
    document.getElementById("verdict").textContent = "Discovery in progress...";
    document.getElementById("meta").textContent = "Last analyzed: --";
    renderFlags([]);
    return;
  }

  scoreEl.style.display = "block";
  spinnerEl.classList.remove("active");
  const score = Math.max(0, Math.min(100, Math.round(analysis.score || 0)));
  scoreEl.textContent = `${score}`;
  const verdictEl = document.getElementById("verdict");
  verdictEl.textContent = analysis.verdict || "Unknown";
  verdictEl.style.color = verdictColor(score);
  document.getElementById("meta").textContent = `Last analyzed: ${formatTime(analysis.analyzedAt)}`;
  renderFlags(analysis.redFlags || []);
}


async function initialize() {
  setStatus("Loading...");
  const tab = await getActiveTab();
  const url = tab?.url || "";
  let domain = "--";
  try {
    domain = new URL(url).hostname;
  } catch (_error) {
    domain = "--";
  }

  const reanalyzeBtn = document.getElementById("reanalyzeBtn");
  if (reanalyzeBtn) {
    reanalyzeBtn.onclick = () => {
      renderAnalysis(domain, null);
      chrome.runtime.sendMessage({ type: "CLEAR_CACHE", url }, () => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "FORCE_REANALYZE" }).catch(() => {});
        }
      });
    };
  }

  chrome.runtime.sendMessage({ type: "GET_ANALYSIS_FOR_TAB", url }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`Unable to load data: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (!response?.ok) {
      setStatus("Backend analysis data unavailable.");
      return;
    }
    renderAnalysis(domain, response.data);
    if (!response.data) {
      setStatus("Searching for privacy links...");
    } else if (response.data.isRateLimit) {
      setStatus("Rate limit reached. Please wait 60s.");
    } else if (response.data.fallbackUsed) {
      setStatus("Showing fallback score because AI call failed.");
    } else {
      setStatus("Analysis complete.");
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "ANALYSIS_COMPLETED") {
    console.log("T&C Digest: Analysis completed, refreshing popup...");
    initialize();
  }
});

initialize().catch((error) => {
  setStatus(`Popup error: ${error.message}`);
});
