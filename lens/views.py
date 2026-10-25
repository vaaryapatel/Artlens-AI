import logging
import os
import time

from django.shortcuts import render
from google import genai
from google.genai import errors as genai_errors
from PIL import Image

logger = logging.getLogger(__name__)

# Initialize the Gemini client using the environment variable
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

PROMPT = (
    "Analyze this image as an art historian and visual expert. Provide:\n"
    "1. **Identification:** Title, possible artist or era, and estimated creation date/century.\n"
    "2. **Visual & Formal Description:** Breakdown of composition, lighting, brushwork, palette, and texture.\n"
    "3. **Interpretive Context:** Potential themes, symbolic elements, and cultural resonance."
)


def _run_pipeline(img):
    """Run the CLIP -> FAISS / PCA -> SVM pipeline (src/pipeline.py).

    Returns the result dict, or None when the pipeline cannot run here
    (torch / open_clip not installed, or the models and FAISS index have not
    been built yet). The view then falls back to the Gemini-only behaviour.
    """
    try:
        from src.pipeline import analyze

        # Gemini writes the description, so the pipeline's own LLM step is skipped.
        return analyze(img.convert("RGB"), use_llm=False)
    except Exception as exc:
        logger.warning("ML pipeline unavailable, using Gemini only: %s", exc)
        return None


def _grounding(result):
    """Verified metadata or classifier estimate, phrased as context for Gemini."""
    from src.llm_description import build_context

    if result["identification"] == "known":
        return build_context(result["similar_works"][0], None)
    return build_context(
        None, {"style": result["style_estimate"], "period": result["period_estimate"]}
    )


def _clean(value):
    """Missing metadata arrives as None or NaN; show neither."""
    if value is None or (isinstance(value, float) and value != value):
        return None
    return value


def _summarise(result):
    """Flatten the pipeline result into what the template needs."""
    if not result:
        return None
    known = result["identification"] == "known"
    summary = {
        "known": known,
        "warnings": result.get("quality", {}).get("warnings", []),
        "confidence": round(result.get("confidence", 0) * 100),
        "note": result.get("note", ""),
    }
    if known:
        summary.update(
            title=_clean(result.get("title")),
            artist=_clean(result.get("artist")),
            year=_clean(result.get("year")),
            age_years=_clean(result.get("age_years")),
            style=_clean(result.get("style")),
        )
    else:
        summary["style_estimate"] = [(l, round(p * 100)) for l, p in result["style_estimate"]]
        summary["period_estimate"] = [(l, round(p * 100)) for l, p in result["period_estimate"]]
    return summary


GEMINI_BUSY_MESSAGE = (
    "Gemini is busy right now (a temporary overload on Google's side). "
    "Please press Analyze again in a minute."
)


def _ask_gemini(img, prompt, attempts=3):
    """Call Gemini, retrying on 5xx errors such as 503 'high demand'.

    Returns the reply text, or None if every attempt failed with a server error.
    Other errors (bad key, bad request) are not retried and still raise.
    """
    for attempt in range(attempts):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=[img, prompt],
            )
            return response.text
        except genai_errors.ServerError as exc:
            logger.warning("Gemini server error (attempt %d/%d): %s", attempt + 1, attempts, exc)
            if attempt < attempts - 1:
                time.sleep(2 ** (attempt + 1))  # wait 2 s, then 4 s
    return None


def analyze_view(request):
    analysis_result = None
    pipeline = None
    if request.method == "POST" and request.FILES.get("artwork_image"):
        image_file = request.FILES["artwork_image"]

        # Open image using Pillow
        img = Image.open(image_file)

        pipeline_result = _run_pipeline(img)
        pipeline = _summarise(pipeline_result)

        prompt = PROMPT
        if pipeline_result:
            prompt += (
                "\n\n" + _grounding(pipeline_result)
                + "\nUse this as ground truth where it matches what you see; "
                "if it conflicts with the image, say so. Say when something is uncertain."
            )

        analysis_result = _ask_gemini(img, prompt) or GEMINI_BUSY_MESSAGE

    return render(
        request,
        "lens/analyze.html",
        {"analysis_result": analysis_result, "pipeline": pipeline},
    )