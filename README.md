# ArtLens AI

ArtLens AI takes a photo of a painting or drawing and returns:

- **Known artwork:** title, artist and year, when the image matches a work in the reference database.
- **Unknown artwork:** an estimated style and 50-year period, with a confidence score.
- **Description:** a short natural-language description written by a vision LLM.

Dates for unknown works are style-based estimates, not proof of age.

## How it works

1. **Preprocessing:** blur and glare check, then canvas crop.
2. **Embedding:** the image is encoded with CLIP.
3. **Known-artwork path:** the embedding is searched in a FAISS index of reference paintings. If the similarity meets `KNOWN_THRESHOLD` (set in `config.py`), the matched work's metadata is returned.
4. **Unknown-artwork path:** the embedding is reduced with PCA and passed to an SVM that predicts style and 50-year period.
5. **Description:** a vision LLM (Gemini multimodal analyzer, see `src/`) receives the image plus either the matched metadata or the style estimate, and returns a description as JSON.
6. **Web app:** a Django backend serves the pipeline through a web interface. The app is packaged with Docker.

### Design choices

- CLIP is the main feature extractor. ResNet50 (ImageNet) is used as a baseline.
- PCA is fitted on training data only and is used for the classifier. Retrieval uses the raw CLIP embeddings, because PCA can discard fine detail needed to tell similar works apart.
- Train/test splits are grouped by artist, so the model is tested on artists it has not seen.
- The Streamlit prototype was replaced by Django so the app has proper routing, a separate backend and a deployable structure.

## Tech stack

Python, CLIP, FAISS, PCA, SVM (scikit-learn), Gemini vision model, Django, Docker.

## Project structure

```
artlens/            Django project settings and URLs
lens/               Django app: views, URLs, pipeline integration
templates/lens/     HTML templates
src/                preprocessing, feature extraction, PCA, classifier,
                    retrieval, LLM description, pipeline
scripts/            embedding build, splits, PCA experiment,
                    classifier training, index build, Met download
models/             trained artifacts (git-ignored)
data/, reports/     generated data and results (git-ignored)
notebooks/          exploration
config.py           paths, thresholds, model names
Dockerfile
docker-compose.yml
manage.py
requirements.txt
.env.example
```

## Data

- **Style labels:** WikiArt.
- **Dates and metadata:** Met Open Access API and Art Institute of Chicago API.
- **Metadata file:** `data/artwork_metadata.csv` with columns `image_path`, `title`, `artist`, `year`, `style`, `source`, `is_reference`. Rows with `is_reference = 1` go into the FAISS index.
- Check each source's license before using the images.
- `scripts/download_met_sample.py` is a starter script for the Met API.

## Setup

### 1. Environment variables

```bash
cp .env.example .env
```

Open `.env` and add your API key(s). `GEMINI_API_KEY`. Never commit `.env`.

### 2. Build the data and models (run once)

```bash
pip install -r requirements.txt
python scripts/build_embeddings.py      # CLIP embeddings, then ResNet50 baseline
python scripts/run_pca_experiment.py    # variance curve and results table in reports/
python scripts/train_classifiers.py     # saves PCA and classifier artifacts
python scripts/build_index.py           # builds the FAISS index
```

### 3. Run the app with Docker

```bash
docker-compose up --build
```

Then open http://localhost:8000 .

### Run without Docker

```bash
python manage.py migrate
python manage.py runserver
```

## Evaluation

| Part | Metrics |
| --- | --- |
| Style / period classifier | Accuracy, macro-F1, confusion matrix, mean year error |
| PCA | Variance curve; with vs without PCA; CLIP vs ResNet50 |
| Retrieval | Top-1 and Top-5 accuracy on held-out photos of reference paintings |
| LLM baseline | Same images sent to a vision LLM without the pipeline, compared on period accuracy and hallucination rate |

A set of 50-100 phone photos of printed or framed art is used to tune `KNOWN_THRESHOLD`.

### Results

"Evaluation in progress"

## Status

- Working: embedding, FAISS retrieval, style classifier, Django app in Docker
- In progress: evaluation, larger dataset
- Planned: deployment

## Limitations

- Style and period are estimates; the system does not authenticate artworks.
- Accuracy drops on unseen artists, heavy glare, crops and reproductions.
- LLM descriptions can contain errors, so they are grounded in the retrieved metadata or the predicted style.

## Authors

- Manasvi Pathak ([@pathakmanasvi](https://github.com/pathakmanasvi))
- Vaarya Patel [@vaaryapatel](https://github.com/vaaryapatel)
