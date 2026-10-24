FROM python:3.12-slim

WORKDIR /app

# Install system dependencies required for OpenCV/Pillow image processing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first for efficient caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the project files
COPY . .

EXPOSE 8000

# Start the Django app
CMD ["sh", "-c", "python manage.py runserver 0.0.0.0:${PORT:-10000}"]