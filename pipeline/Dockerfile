FROM python:3.12-slim

# Install ffmpeg with libx264 support, plus fonts for ASS subtitles
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto-cjk \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Rebuild font cache
RUN fc-cache -fv

WORKDIR /app

# Install dependencies
COPY pipeline/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy pipeline code
COPY pipeline/ /app/pipeline/

ENTRYPOINT ["python3", "/app/pipeline/run_fargate.py"]
