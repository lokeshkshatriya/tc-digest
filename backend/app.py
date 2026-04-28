import os

from flask import Flask, jsonify, request
from flask_cors import CORS

from services.scorer import analyze_terms_text


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/health")
    def health() -> tuple:
        return jsonify({"status": "ok"}), 200

    @app.post("/analyze")
    def analyze() -> tuple:
        payload = request.get_json(silent=True) or {}
        text = payload.get("text", "")
        url = payload.get("url", "")
        domain = payload.get("domain", "")
        title = payload.get("title", "")

        if not text:
            return (
                jsonify(
                    {
                        "score": 50,
                        "verdict": "Unknown",
                        "redFlags": ["No page text was provided."],
                        "summary": "Analysis unavailable due to missing content.",
                        "fallbackUsed": True,
                    }
                ),
                200,
            )

        api_key = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("AI_API_KEY", "")

        result = analyze_terms_text(
            text=text,
            url=url,
            domain=domain,
            title=title,
            api_key=api_key,
        )
        return jsonify(result), 200

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
