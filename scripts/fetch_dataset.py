"""Build data/artwork_metadata.csv + data/raw_images/ from Wikidata / Wikimedia Commons.
 
Wikidata gives, per painting: title, artist, creation year, art movement (the style label)
and an image on Wikimedia Commons. Existing rows (e.g. the Cleveland ones) are kept.
 
Run from the project root:
    python -m scripts.fetch_dataset
    python -m scripts.fetch_dataset --per-style 120 --per-artist 20
    python -m scripts.fetch_dataset --styles Impressionism Baroque   # subset
"""
import argparse
import io
import random
import time
from pathlib import Path
 
import pandas as pd
import requests
from PIL import Image
 
import config
 
SPARQL_URL = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "ArtLensStudentProject/1.0 (university ML course project; contact: student)",
    "Accept": "application/json",
}
COLUMNS = ["image_path", "title", "artist", "year", "style", "source", "is_reference"]
 
# style label -> Wikidata item of the art movement (the query also includes sub-movements).
# The script prints the label Wikidata has for each ID so you can spot a wrong one.
STYLE_QIDS = {
    "Impressionism": "Q40415",
    "Post-Impressionism": "Q166713",
    "Baroque": "Q37853",
    "Romanticism": "Q37068",
    "Realism": "Q39427",
    "Renaissance": "Q4692",
}
 
MIN_YEAR, MAX_YEAR = 1300, 1950
MAX_SIDE = 768
 
 
def sparql(query, retries=3):
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(SPARQL_URL, params={"query": query, "format": "json"},
                             headers=HEADERS, timeout=120)
            if r.status_code == 200:
                return r.json()["results"]["bindings"]
            print(f"    SPARQL HTTP {r.status_code} (attempt {attempt}): {r.text[:150]!r}")
        except requests.RequestException as e:
            print(f"    SPARQL error (attempt {attempt}): {e}")
        time.sleep(5 * attempt)
    return []
 
 
def check_qids():
    ids = " ".join(f"wd:{q}" for q in STYLE_QIDS.values())
    rows = sparql(f"""SELECT ?m ?mLabel WHERE {{ VALUES ?m {{ {ids} }}
        SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }} }}""")
    labels = {r["m"]["value"].rsplit("/", 1)[-1]: r["mLabel"]["value"] for r in rows}
    print("Movement IDs on Wikidata:")
    for style, q in STYLE_QIDS.items():
        print(f"  {style:20s} {q:10s} -> {labels.get(q, '???')}")
    print()
 
 
def candidates(qid, limit, with_subclasses=True):
    path = f"wdt:P135/wdt:P279* wd:{qid}" if with_subclasses else f"wdt:P135 wd:{qid}"
    q = f"""
    SELECT ?p ?pLabel ?artistLabel ?year ?img WHERE {{
      ?p wdt:P31 wd:Q3305213 ;
         {path} ;
         wdt:P18 ?img ;
         wdt:P170 ?artist ;
         wdt:P571 ?date .
      BIND(YEAR(?date) AS ?year)
      FILTER(?year >= {MIN_YEAR} && ?year <= {MAX_YEAR})
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }} LIMIT {limit}"""
    rows = sparql(q)
    if not rows and with_subclasses:
        print("    retrying without sub-movements (query may have timed out)")
        rows = sparql(q.replace(path, f"wdt:P135 wd:{qid}"))
    out, seen = [], set()
    for r in rows:
        pid = r["p"]["value"].rsplit("/", 1)[-1]
        title = r.get("pLabel", {}).get("value", "")
        artist = r.get("artistLabel", {}).get("value", "")
        if pid in seen or not title or not artist:
            continue
        if title.startswith("Q") and title[1:].isdigit():
            continue
        if artist.startswith("Q") and artist[1:].isdigit():
            continue
        try:
            year = int(float(r["year"]["value"]))
        except (KeyError, ValueError):
            continue
        seen.add(pid)
        out.append({"pid": pid, "title": title, "artist": artist, "year": year,
                    "img": r["img"]["value"]})
    return out
 
 
def download_image(url, dest):
    # Special:FilePath redirects to the file; ?width= asks Commons for a resized copy.
    url = url.replace("http://", "https://") + f"?width={MAX_SIDE}"
    for attempt in range(1, 4):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            if r.status_code == 429:
                time.sleep(10 * attempt)
                continue
            if r.status_code != 200:
                return False
            img = Image.open(io.BytesIO(r.content)).convert("RGB")
            img.thumbnail((MAX_SIDE, MAX_SIDE))
            dest.parent.mkdir(parents=True, exist_ok=True)
            img.save(dest, "JPEG", quality=90)
            return True
        except Exception:
            time.sleep(2 * attempt)
    return False
 
 
def main(styles, per_style, per_artist, fetch_limit, seed):
    random.seed(seed)
    try:
        requests.get("https://www.wikidata.org", headers=HEADERS, timeout=20).raise_for_status()
    except Exception as e:
        raise SystemExit(f"Cannot reach Wikidata: {e}")
    print("Wikidata reachable.\n")
    check_qids()
 
    meta_path = Path(config.METADATA_CSV)
    raw_dir = Path(config.RAW_DIR)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
 
    if meta_path.exists() and meta_path.stat().st_size > 0:
        existing = pd.read_csv(meta_path)
        print(f"Keeping {len(existing)} existing rows from {meta_path.name}\n")
    else:
        existing = pd.DataFrame(columns=COLUMNS)
 
    existing_keys = set(zip(existing["title"].str.lower(), existing["artist"].str.lower()))
    new_rows = []
 
    for style in styles:
        qid = STYLE_QIDS[style]
        have = int((existing["style"] == style).sum())
        need = per_style - have
        print(f"=== {style} ({qid}): have {have}, want {per_style} ===")
        if need <= 0:
            print("  already enough, skipping\n")
            continue
 
        cands = candidates(qid, fetch_limit)
        print(f"  {len(cands)} candidate paintings with image, artist and year")
        random.shuffle(cands)
 
        per_artist_count = {}
        kept = 0
        for c in cands:
            if kept >= need:
                break
            key = (c["title"].lower(), c["artist"].lower())
            if key in existing_keys:
                continue
            if per_artist_count.get(c["artist"], 0) >= per_artist:
                continue
            rel = f"wikidata/{c['pid']}.jpg"
            dest = raw_dir / rel
            if not dest.exists() and not download_image(c["img"], dest):
                continue
            time.sleep(0.3)
            per_artist_count[c["artist"]] = per_artist_count.get(c["artist"], 0) + 1
            existing_keys.add(key)
            kept += 1
            new_rows.append({"image_path": rel, "title": c["title"], "artist": c["artist"],
                             "year": c["year"], "style": style, "source": "wikidata",
                             "is_reference": 1})
            if kept % 20 == 0:
                print(f"  downloaded {kept}/{need}")
        print(f"  kept {kept} new images from {len(per_artist_count)} artists\n")
 
    df = pd.concat([existing, pd.DataFrame(new_rows, columns=COLUMNS)], ignore_index=True)
    df = df.drop_duplicates(subset=["image_path"])
    df.to_csv(meta_path, index=False)
    print(f"Saved {len(df)} rows -> {meta_path}\n")
 
    print("Images per style:")
    print(df["style"].value_counts().to_string(), "\n")
    print("Images per source:")
    print(df["source"].value_counts().to_string(), "\n")
    print("Images per 50-year period:")
    print(df.groupby((df["year"] // 50) * 50).size().to_string(), "\n")
    print("Distinct artists:", df["artist"].nunique())
    print("Artists per style:")
    print(df.groupby("style")["artist"].nunique().to_string())
 
    low = [s for s, n in df["style"].value_counts().items() if n < 30]
    if low:
        print(f"\nWARNING: fewer than 30 images for: {', '.join(low)}")
 
 
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--styles", nargs="+", default=list(STYLE_QIDS), choices=list(STYLE_QIDS))
    ap.add_argument("--per-style", type=int, default=120, help="target total images per style")
    ap.add_argument("--per-artist", type=int, default=20, help="max images per artist per style")
    ap.add_argument("--fetch-limit", type=int, default=2000, help="max SPARQL rows per style")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    main(a.styles, a.per_style, a.per_artist, a.fetch_limit, a.seed)