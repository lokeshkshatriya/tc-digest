import re
from typing import Any, Dict

import requests

def _fallback_result(reason: str) -> Dict[str, Any]:
    return {
        "score": 50,
        "verdict": "Caution",
        "redFlags": [reason],
        "summary": "Automated AI analysis was unavailable, so a neutral fallback score is shown.",
        "fallbackUsed": True,
    }


def _parse_labeled_response(content: str) -> Dict[str, Any]:
    cleaned = content.strip()
    if not cleaned:
        return _fallback_result("Empty AI response.")

    if "|" in cleaned:
        # Some AI models might put the summary on a new line; flatten it out.
        cleaned = cleaned.replace('\n', ' ')
        # Split but allow for the AI accidentally adding extra pipes or text around the line
        parts = [part.strip() for part in cleaned.split("|")]
        # Filter out empty strings if the AI put pipes at the start/end
        parts = [p for p in parts if p]
        
        if len(parts) >= 2:
            score_part = parts[0]
            score_value = None
            
            # Try to find a number in the first part
            num_match = re.search(r"(\d+)", score_part)
            if num_match:
                score_value = int(num_match.group(1))
                # If it looks like a 1-10 scale, convert to 0-100
                if score_value <= 10 and "/" in score_part:
                    score_value = score_value * 10

            if score_value is not None:
                score = max(0, min(100, score_value))
                verdict = parts[1].capitalize() if len(parts) > 1 else "Caution"
                flags_part = parts[2] if len(parts) > 2 else ""
                summary_part = parts[3] if len(parts) > 3 else "No summary provided."
                
                red_flags = [item.strip()[:180] for item in re.split(r"[;,]", flags_part) if item.strip()]
                if not red_flags:
                    red_flags = ["No specific red flags identified."]
                
                return {
                    "score": score,
                    "verdict": verdict,
                    "redFlags": red_flags[:5],
                    "summary": summary_part[:400],
                    "fallbackUsed": False,
                }

    score_match = re.search(r"(score|rating|privacy score)\s*[:\-]\s*(\d+)", cleaned, re.IGNORECASE)
    verdict_match = re.search(r"(verdict|risk level|risk)\s*[:\-]\s*(safe|caution|risky)", cleaned, re.IGNORECASE)
    summary_match = re.search(r"(summary|reason|overview)\s*[:\-]\s*(.+)", cleaned, re.IGNORECASE)
    flags_match = re.search(r"(flags|red flags)\s*[:\-]\s*(.+)", cleaned, re.IGNORECASE)

    flag_lines = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if re.match(r"^[-*]\s+", stripped):
            flag_lines.append(re.sub(r"^[-*]\s+", "", stripped))
        elif re.match(r"^(red\s*flag|flag|issue|concern)\s*\d*\s*[:\-]\s*", stripped, re.IGNORECASE):
            flag_lines.append(
                re.sub(r"^(red\s*flag|flag|issue|concern)\s*\d*\s*[:\-]\s*", "", stripped, flags=re.IGNORECASE)
            )

    if flags_match:
        inline_flags = [item.strip() for item in re.split(r"[;,|]", flags_match.group(2)) if item.strip()]
        flag_lines.extend(inline_flags)

    if not score_match or not verdict_match:
        return _fallback_result("Could not parse AI response format.")

    score = max(0, min(100, int(score_match.group(2))))
    verdict = verdict_match.group(2).capitalize()
    summary = summary_match.group(2).strip()[:400] if summary_match else "No summary returned."
    red_flags = [flag[:180] for flag in flag_lines[:5]]
    if not red_flags:
        red_flags = ["No red flags returned by AI."]

    return {
        "score": score,
        "verdict": verdict,
        "redFlags": red_flags,
        "summary": summary,
        "fallbackUsed": False,
    }


def analyze_terms_text(text: str, url: str, domain: str, title: str, api_key: str) -> Dict[str, Any]:
    if not api_key:
        return _fallback_result("Missing GEMINI_API_KEY in backend environment.")

    clipped_text = text[:1500]
    prompt = f"""
You are a balanced privacy policy analyst. Analyze the following legal text for privacy risks using a REALISTIC, FAIR scoring scale.

SCORING RUBRIC (use this as your anchor):
- 85-100 (Safe): Excellent privacy. Minimal data collection, no third-party selling, easy deletion, transparent.
- 65-84 (Caution): Standard modern privacy. Collects some data for services, some third-party sharing, but is honest and compliant.
- 40-64 (Risky): Concerning privacy. Sells or shares data broadly, unclear policies, tracks beyond what's needed.
- 0-39 (Very Risky): Extremely invasive. Mass data selling, no deletion rights, deceptive practices.

IMPORTANT: Most legitimate websites with a real privacy policy should score between 60-80. Only score below 50 if there are CLEAR, SPECIFIC harmful practices in the text. Do NOT penalize sites simply for collecting normal operational data.

Provide:
1. A score (0-100) using the rubric above
2. A verdict: Safe, Caution, or Risky
3. 3-5 specific red flags (be specific, not generic)
4. A 1-2 sentence summary

STRICT FORMAT — return ONLY this single pipe-delimited line, nothing else:
score|verdict|flag1;flag2;flag3|summary

Example:
72|Caution|Shares data with advertising partners;Location tracking enabled;30-day deletion delay|The site collects standard usage data and shares it with advertisers, but is transparent about its practices.

Text to analyze:
{clipped_text}
"""

    try:
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "generationConfig": {
                    "temperature": 0.1, # Lowered for more consistency
                    "maxOutputTokens": 512,
                },
                "contents": [
                    {
                        "parts": [{"text": prompt}],
                    }
                ],
            },
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload["candidates"][0]["content"]["parts"][0]["text"]
        print("\n===== RAW GEMINI RESPONSE START =====")
        print(repr(content))
        print("===== RAW GEMINI RESPONSE END =====\n")
        return _parse_labeled_response(content)

    except Exception as exc:
        error_str = str(exc)
        if "429" in error_str:
            return {
                "score": 50,
                "verdict": "Rate Limited",
                "redFlags": ["Gemini API rate limit reached (429)."],
                "summary": "The AI is currently busy. Please wait about 60 seconds before analyzing another site.",
                "fallbackUsed": True,
                "isRateLimit": True,
            }
        if "503" in error_str:
            return {
                "score": 50,
                "verdict": "Service Down",
                "redFlags": ["Gemini API is temporarily unavailable (503)."],
                "summary": "Google's AI servers are currently overloaded or down. Please try again in a few minutes.",
                "fallbackUsed": True,
            }
        return _fallback_result(f"AI call failed: {exc}")
