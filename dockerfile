FROM python:3.12-slim
 
WORKDIR /app
 
# System libraries needed by OpenCV / Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
&& rm -rf /var/lib/apt/lists/*
 
# 1) CPU-only torch first (the default Linux wheel pulls several GB of CUDA libraries)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
 
# 2) Everything else (torch is already satisfied, so it is not reinstalled)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
 
# 3) Download the CLIP weights now, so the first request on a new instance is not slow
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')"
 
# 4) Project code + trained models (models/ is only ~3 MB)
COPY . .
 
EXPOSE 8000
 
# --noreload: no file watcher needed inside a container
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000", "--noreload"]