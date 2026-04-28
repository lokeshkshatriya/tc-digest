// ⚠️ DEPLOYMENT: Replace this with your Render URL e.g. https://tc-digest-api.onrender.com
const API_BASE_URL = "http://127.0.0.1:5000";
const CACHE_PREFIX = "analysis:";
const COOKIE_TOGGLE_KEY = "cookieAutoRejectEnabled";
const inFlightRequests = new Set();

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (_error) {
    return "unknown";
  }
}

function getCacheKey(domain) {
  return `${CACHE_PREFIX}${domain}`;
}

async function getStoredValue(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function setStoredValue(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function setBadge(score) {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const text = `${safeScore}`;
  let color = "#d97706";
  if (safeScore >= 70) {
    color = "#16a34a";
  } else if (safeScore < 40) {
    color = "#dc2626";
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function analyzeSitePayload(payload) {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Backend request failed with ${response.status}`);
  }

  return response.json();
}

function normalizeAnalysisResult(data, domain) {
  return {
    domain,
    score: typeof data.score === "number" ? data.score : 50,
    verdict: data.verdict || "Unknown",
    redFlags: Array.isArray(data.redFlags) ? data.redFlags.slice(0, 5) : [],
    summary: data.summary || "No summary available.",
    fallbackUsed: Boolean(data.fallbackUsed),
    analyzedAt: new Date().toISOString()
  };
}

async function handleAnalyzeRequest(message, sender) {
  const tabUrl = sender?.tab?.url || message.url || "";
  const domain = getDomain(tabUrl);
  const cacheKey = getCacheKey(domain);

  if (inFlightRequests.has(domain)) {
    console.log(`T&C Guard: Analysis already in flight for ${domain}`);
    return { status: "pending" };
  }

  inFlightRequests.add(domain);
  try {
    // Clear any old fallback cache so the popup shows "Discovery in progress..."
    await chrome.storage.local.remove(cacheKey);
    await chrome.action.setBadgeText({ text: "..." });
    await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });

    const payload = {
      url: tabUrl,
      domain,
      title: message.title || "",
      text: message.text || ""
    };

    const result = await analyzeSitePayload(payload);
    const normalized = normalizeAnalysisResult(result, domain);

    await setStoredValue(cacheKey, normalized);
    await setBadge(normalized.score);
    chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETED", domain }).catch(() => { });
    return normalized;
  } finally {
    inFlightRequests.delete(domain);
  }
}

async function handleDiscoveredLinkRequest(message) {
  const { url, title, originalUrl } = message;
  const domain = getDomain(originalUrl || url);
  const cacheKey = getCacheKey(domain);

  if (inFlightRequests.has(domain)) {
    return { status: "pending" };
  }

  // Double check cache. If we have a cached error/fallback, we SHOULD retry.
  const existing = await getStoredValue(cacheKey);
  if (existing && !existing.fallbackUsed) return existing;

  inFlightRequests.add(domain);
  try {
    console.log(`T&C Guard: Fetching remote content from ${url}`);
    
    // Clear old cache so the popup shows "Discovery in progress..."
    await chrome.storage.local.remove(cacheKey);
    await chrome.action.setBadgeText({ text: "..." });
    await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });

    // Add a 10-second timeout to prevent hanging on anti-bot sites like Flipkart
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    
    if (!response.ok) throw new Error(`Failed to fetch legal page: ${response.status}`);
    
    const html = await response.text();
    const text = stripTags(html).slice(0, 12000);

    // If the text is extremely short, it's likely a React/SPA app where content is loaded via JS.
    if (text.length < 200) {
      console.log(`T&C Guard: Text too short (${text.length} chars). Likely an SPA.`);
      const spaResult = {
        score: 50,
        verdict: "Unknown",
        summary: "This site uses dynamic loading. The extension cannot read the policy in the background.",
        redFlags: ["Please click on the Privacy Policy link to navigate there directly."],
        fallbackUsed: true
      };
      await setStoredValue(cacheKey, spaResult);
      await setBadge(50);
      chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETED", domain }).catch(() => {});
      return spaResult;
    }

    const payload = {
      url,
      domain,
      title: title || "Privacy Policy",
      text
    };

    const result = await analyzeSitePayload(payload);
    const normalized = normalizeAnalysisResult(result, domain);
    
    await setStoredValue(cacheKey, normalized);
    await setBadge(normalized.score);
    chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETED", domain }).catch(() => {});
    return normalized;
  } catch (error) {
    console.error("T&C Guard Discovery failed:", error);
    const isAbort = error.name === 'AbortError';
    const errorResult = {
      score: 50,
      verdict: "Unknown",
      summary: isAbort ? "Connection timed out. The site might have anti-bot protection." : `Analysis failed: ${error.message}`,
      redFlags: ["Please navigate directly to the privacy page to analyze it."],
      fallbackUsed: true
    };
    await setStoredValue(cacheKey, errorResult);
    await setBadge(50);
    chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETED", domain }).catch(() => {});
    return errorResult;
  } finally {
    inFlightRequests.delete(domain);
  }
}

function stripTags(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ANALYZE_PAGE") {
    handleAnalyzeRequest(message, sender)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => {
        console.error("Analyze failed:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "ANALYZE_DISCOVERED_LINK") {
    handleDiscoveredLinkRequest(message)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => {
        console.error("Discovery analysis failed:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "SAVE_NOT_FOUND") {
    const domain = getDomain(message.domain);
    const cacheKey = getCacheKey(domain);
    const notFoundResult = {
      score: 50,
      verdict: "Unknown",
      summary: "Could not automatically find a privacy policy or terms link on this page.",
      redFlags: ["Try navigating directly to the privacy page to analyze it."],
      fallbackUsed: true
    };

    setStoredValue(cacheKey, notFoundResult).then(() => {
      setBadge(50);
      chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETED", domain }).catch(() => { });
    });

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "GET_ANALYSIS_FOR_TAB") {
    const domain = getDomain(message.url || "");
    const cacheKey = getCacheKey(domain);
    getStoredValue(cacheKey)
      .then((data) => sendResponse({ ok: true, data: data || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_CACHE") {
    const domain = getDomain(message.url);
    const cacheKey = getCacheKey(domain);
    inFlightRequests.delete(domain);
    chrome.storage.local.remove(cacheKey).then(() => {
      chrome.action.setBadgeText({ text: "" }); // Reset globally, or use tabId if we had it
      syncBadge(); // Sync badge will clear it
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

async function syncBadge() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.url) return;
    const domain = getDomain(tabs[0].url);
    
    if (inFlightRequests.has(domain)) {
      await chrome.action.setBadgeText({ text: "..." });
      await chrome.action.setBadgeBackgroundColor({ color: "#64748b" });
      return;
    }
    
    const cacheKey = getCacheKey(domain);
    const existing = await getStoredValue(cacheKey);
    if (existing && existing.score !== undefined) {
      await setBadge(existing.score);
    } else {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch (e) {
    // Ignore errors when querying tabs
  }
}

chrome.tabs.onActivated.addListener(syncBadge);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    syncBadge();
  }
});
