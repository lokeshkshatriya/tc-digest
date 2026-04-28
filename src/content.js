const KEYWORDS = ["terms", "privacy", "signup", "register", "login", "cookie"];
const MAX_TEXT_LENGTH = 12000;

let analysisSent = false;

function isRelevantPage() {
  const fullText = `${location.href} ${document.title}`.toLowerCase();
  return KEYWORDS.some((keyword) => fullText.includes(keyword));
}

function extractVisibleText() {
  const containers = ["main", "article", "section", "body"];
  let collected = "";

  for (const selector of containers) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    const text = (element.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length > collected.length) {
      collected = text;
    }
  }

  return collected.slice(0, MAX_TEXT_LENGTH);
}

let analysisRetries = 0;

function sendForAnalysis() {
  if (analysisSent || !isRelevantPage()) {
    return;
  }
  const text = extractVisibleText();
  if (!text || text.length < 400) {
    if (analysisRetries < 5) {
      analysisRetries++;
      setTimeout(sendForAnalysis, 1000); // Retry after 1 second to wait for SPA to load
    }
    return;
  }

  analysisSent = true;
  chrome.runtime.sendMessage(
    {
      type: "ANALYZE_PAGE",
      url: location.href,
      title: document.title,
      text
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Analysis message failed:", chrome.runtime.lastError.message);
        return;
      }
      if (!response?.ok) {
        console.warn("Analysis backend returned error:", response?.error || "Unknown error");
      }
    }
  );
}


function findLegalLink() {
  const links = Array.from(document.querySelectorAll("a"));
  const keywords = ["privacy policy", "privacy", "terms of service", "terms of use", "terms and conditions", "terms"];
  
  for (const keyword of keywords) {
    const link = links.find(l => {
      const text = (l.innerText || "").toLowerCase().trim();
      const aria = (l.getAttribute("aria-label") || "").toLowerCase().trim();
      const href = (l.getAttribute("href") || "").toLowerCase();
      return text.includes(keyword) || aria.includes(keyword) || href.includes(keyword.replace(" ", "")) || href.includes(keyword.replace(" ", "-"));
    });
    if (link && link.href && link.href.startsWith("http")) {
      return { url: link.href, title: (link.innerText || "Legal Page").trim(), node: link };
    }
  }
  return null;
}

function discoverAndAnalyze(attempts = 0) {
  if (analysisSent || isRelevantPage()) {
    return;
  }

  // Check if we already have a SUCCESSFUL analysis for this domain to avoid double-fetching
  chrome.runtime.sendMessage({ type: "GET_ANALYSIS_FOR_TAB", url: location.href }, (response) => {
    // If we have data and it wasn't a fallback, we're good
    if (response?.ok && response.data && !response.data.fallbackUsed) {
      return;
    }

    const legalLink = findLegalLink();
    if (legalLink) {
      console.log("T&C Guard: Discovered legal link:", legalLink.url);
      analysisSent = true;
      chrome.runtime.sendMessage({
        type: "ANALYZE_DISCOVERED_LINK",
        url: legalLink.url,
        title: legalLink.title,
        originalUrl: location.href
      }, (response) => {
        if (response?.data?.fallbackUsed) {
          console.log("T&C Guard: Background analysis failed. Prompting user to click.");
          highlightFailedLink(legalLink.node);
        }
      });
    } else if (attempts < 4) {
      // Retry every 2 seconds (up to 8 seconds total) for sites that load slowly
      setTimeout(() => discoverAndAnalyze(attempts + 1), 2000);
    } else {
      console.log("T&C Guard: Could not find any legal links.");
      chrome.runtime.sendMessage({
        type: "SAVE_NOT_FOUND",
        domain: location.href
      });
    }
  });
}

function highlightFailedLink(node) {
  if (!node || !document.body.contains(node)) {
    console.warn("T&C Guard: Link no longer in DOM to highlight.");
    return;
  }

  // Auto-scroll to the link smoothly
  node.scrollIntoView({ behavior: "smooth", block: "center" });

  // Save original styles to restore later
  const originalOutline = node.style.outline;
  const originalBackground = node.style.backgroundColor;
  const originalTransition = node.style.transition;
  const originalBorderRadius = node.style.borderRadius;

  // Apply highlight styles
  node.style.transition = "all 0.3s ease-in-out";
  node.style.outline = "4px solid #ef4444";
  node.style.backgroundColor = "#fef08a";
  node.style.borderRadius = "4px";

  // Create toast notification
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e293b;
    color: #f8fafc;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    z-index: 2147483647; /* Max z-index */
    display: flex;
    align-items: center;
    gap: 16px;
    border: 1px solid #334155;
    animation: tcg-slide-up 0.3s ease-out;
  `;

  // Inject keyframes if not present
  if (!document.getElementById("tcg-styles")) {
    const style = document.createElement("style");
    style.id = "tcg-styles";
    style.textContent = `
      @keyframes tcg-slide-up {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  const text = document.createElement("span");
  text.textContent = "T&C Digest couldn't read the policy automatically. Please click the highlighted link.";
  toast.appendChild(text);

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cssText = `
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    margin: -4px -8px -4px 0;
  `;
  
  closeBtn.onmouseover = () => closeBtn.style.color = "#f8fafc";
  closeBtn.onmouseout = () => closeBtn.style.color = "#94a3b8";

  const cleanup = () => {
    node.style.outline = originalOutline;
    node.style.backgroundColor = originalBackground;
    node.style.transition = originalTransition;
    node.style.borderRadius = originalBorderRadius;
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  };

  closeBtn.onclick = (e) => {
    e.stopPropagation();
    cleanup();
  };
  
  node.addEventListener("click", cleanup, { once: true });

  toast.appendChild(closeBtn);
  document.body.appendChild(toast);
}

function initialize() {
  sendForAnalysis();
  discoverAndAnalyze();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FORCE_REANALYZE") {
    analysisSent = false;
    analysisRetries = 0;
    initialize();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
