# T&C Digest

> AI-powered privacy policy analyzer Chrome extension — built for the Google Solution Challenge 2026.

T&C Digest automatically reads and scores the privacy policy of every website you visit using Google Gemini AI, so you can make informed decisions before signing up.

## ✨ Features

- **Auto-Discovery** — Scans every page for Privacy Policy / Terms links in the background
- **Gemini AI Scoring** — Rates policies from 0–100 with a verdict (Safe / Caution / Risky) and specific red flags
- **Link Highlighting** — If a policy can't be read in the background, the extension scrolls to and highlights the link on the page
- **Live Badge** — Color-coded score badge on the Chrome toolbar updates per-tab
- **Re-Analyze Button** — Force a fresh AI analysis without refreshing the page
- **Smart Caching** — Results are cached per-domain for fast popup rendering
- **Rate Limit & Error Handling** — Graceful handling of 429, 503, and timeout errors

## 🗂 Project Structure

```
├── manifest.json             # Chrome MV3 manifest
├── src/
│   ├── content.js            # Page scanning, text extraction, link highlight
│   ├── background.js         # Fetching, caching, badge updates, messaging
│   ├── popup.html            # Extension popup UI
│   ├── popup.css             # Popup styles
│   └── popup.js              # Popup logic
├── backend/
│   ├── app.py                # Flask server
│   ├── requirements.txt      # Python dependencies
│   ├── Procfile              # Cloud deployment config
│   └── services/
│       └── scorer.py         # Gemini AI scoring logic
└── landing/
    └── index.html            # Landing page
```

## 🚀 Local Setup (~5 minutes)

### 1. Backend
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Set your Gemini API key (PowerShell):
```powershell
$env:GEMINI_API_KEY="your_api_key_here"
```

Start the server:
```bash
python app.py
```

### 2. Chrome Extension
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **project root folder** (the folder containing `manifest.json`)

## 🌐 Backend Deployment (Render.com)

1. Push the `backend/` folder to a GitHub repo
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set **Root Directory** to `backend`
4. Add `GEMINI_API_KEY` as an Environment Variable
5. Update `API_BASE_URL` in `src/background.js` with your Render URL

## 📡 API Reference

### `GET /health`
Returns `{"status": "ok"}` when the backend is running.

### `POST /analyze`
**Request body:**
```json
{
  "url": "https://example.com/privacy",
  "domain": "example.com",
  "title": "Privacy Policy",
  "text": "...policy text..."
}
```
**Response:**
```json
{
  "score": 72,
  "verdict": "Caution",
  "redFlags": ["Shares data with advertisers", "..."],
  "summary": "...",
  "fallbackUsed": false
}
```

## 🎯 Demo Test Sites

- `https://medium.com` — Background discovery works well
- `https://x.com/en/tos` — Directly on policy page
- `https://duckduckgo.com/privacy` — Should score high (Safe)

## 📝 Notes

- The extension works best when you navigate directly to a Privacy Policy page
- If a site uses JavaScript rendering (SPA), the extension will highlight the link and ask you to navigate there
- AI results are non-deterministic; scores may vary slightly between analyses
