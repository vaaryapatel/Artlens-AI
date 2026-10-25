# ArtLens AI

ArtLens AI turns a photo of a painting or drawing into useful information about it. Upload a picture and the app will:

- **Identify the artwork** (title, artist, year) when it matches a painting in the reference database
- **Estimate the style and period** with a confidence score when it doesn't
- **Estimate the approximate age** of the work
- **Write a description** of the piece using a vision LLM

It is a web app built with Django, with an optional Docker setup for running it in a container.

> **Note:** For artworks that aren't in the reference database, the date is a style-based estimate, not proof of age.

---

## How It Works

```
Photo -> quality check (blur/glare) -> canvas crop -> CLIP embedding
   |-- FAISS search on reference DB -> similarity >= threshold? -> KNOWN: title, artist, year from metadata
   '-- otherwise: PCA -> SVM (style + 50-year period bin) -> UNKNOWN: estimate + confidence
Vision LLM (image + metadata or estimate) -> description
Web UI (Django templates)
```

1. **Preprocessing:** the photo is checked for blur and glare, then cropped to the canvas.
2. **Feature extraction:** the image is converted to an embedding with CLIP (ResNet50 is used as a baseline for comparison).
3. **Retrieval:** the embedding is searched against a FAISS index of reference paintings. If the similarity is above `KNOWN_THRESHOLD`, the artwork is treated as known and its stored metadata is returned.
4. **Classification:** if there is no confident match, the embedding is reduced with PCA and an SVM predicts the style and a 50-year period bin, along with a confidence score.
5. **Description:** the image, plus either the metadata or the estimate, is sent to a vision LLM that writes the description.

### Design choices

- **CLIP** is the main feature extractor; **ResNet50** (ImageNet) is the comparison baseline.
- **PCA** is used for the classifiers only, fit on the training set. Retrieval uses the raw embeddings, since PCA can discard fine detail.
- **Artist-grouped splits** keep the same artist out of both train and test sets, preventing leakage.

---

## Tech Stack

| Area | Tools |
| --- | --- |
| Web app | Django (views, templates, SQLite) |
| Image embeddings | CLIP, ResNet50 (baseline) |
| Similarity search | FAISS |
| Classification | PCA + SVM |
| Descriptions | Anthropic API (vision LLM) |
| Packaging | Docker, Docker Compose |

---

## Project Structure

```
manage.py              Django entry point
config.py              Paths, thresholds, model names
requirements.txt       Python dependencies
.env.example           Template for environment variables
dockerfile             Container image definition
docker-compose.yml     Container setup
templates/             HTML templates for the web UI
src/
  preprocessing.py       Blur/glare check and canvas crop
  feature_extraction.py  CLIP / ResNet50 embeddings
  pca_pipeline.py        PCA fitting and transform
  classifier.py          Style and period classifiers
  retrieval.py           FAISS search for known artworks
  vision_analyzer.py     Vision-model analysis of the image
  llm_description.py     LLM-written description
  pipeline.py            Ties all the steps together
scripts/               Embedding, training, indexing and experiment scripts
notebooks/             Exploration
data/ models/ reports/ Generated artefacts (git-ignored)
```

---

## Getting Started

### 1. Install

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and add your `ANTHROPIC_API_KEY`. Paths, thresholds and model names are set in `config.py`.

### 3. Prepare the data

Create `data/artwork_metadata.csv` with these columns:

| Column | Meaning |
| --- | --- |
| `image_path` | Path relative to `data/raw_images/` |
| `title`, `artist` | Text (artist is used for leakage-safe splitting) |
| `year` | Integer creation year |
| `style` | Label such as Impressionism, Baroque, etc. |
| `source` | `wikiart`, `met` or `aic` |
| `is_reference` | `1` = include in the known-artwork index |

**Sources:** WikiArt (style labels), Met Open Access and Art Institute of Chicago APIs (dates and metadata). `scripts/download_met_sample.py` is a starter for the Met API. Check each source's license before use.

**Suggested size:** 3-5k images across 5-8 styles, plus roughly 500-1000 reference paintings. Include non-Western works where possible.

### 4. Run the app

```bash
python manage.py migrate
python manage.py runserver
```

Then open http://127.0.0.1:8000 in your browser.

**Using Docker instead:**

```bash
docker compose up --build
```

---

## Evaluation

| What | How |
| --- | --- |
| Style / period | Accuracy, macro-F1, confusion matrix, mean year error (`train_classifiers`) |
| PCA | Variance curve; with vs without PCA; CLIP vs ResNet50 (`run_pca_experiment`) |
| Retrieval | Top-1 / Top-5 accuracy on held-out photos of reference paintings |
| Phone-photo test set | 50-100 of your own photos of printed or framed art; use these to tune `KNOWN_THRESHOLD` in `config.py` |
| LLM-only baseline | Send the same images to a vision LLM with no pipeline; compare period accuracy and hallucination rate |

---

## Limitations

- Age for unknown artworks is inferred from style, so treat it as an estimate.
- Identification only works for paintings in your reference index.
- Results depend on photo quality; heavy glare, blur or extreme angles will hurt accuracy.
- The model is only as diverse as the training data you assemble.
