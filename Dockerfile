FROM python:3.10-slim

# System dependencies for PDF/EPUB parsing and general build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for Docker layer caching
COPY requirements.txt .

# Install CPU-only PyTorch first (saves ~2GB vs full CUDA version)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies (use default PyPI index, NOT the torch CPU index)
RUN pip install --no-cache-dir --default-timeout=100 rouge-score
RUN pip install --no-cache-dir -r requirements.txt

# Watchdog for fast file-change detection (Flask reloader)
RUN pip install --no-cache-dir watchdog

# Do NOT copy project files — they come in via the volume mount.
# The COPY below is a fallback so the image works standalone (no mount).
COPY . .

# Create directories for uploads and results
RUN mkdir -p demo/uploads demo/results demo/task_state

# Expose the web server port
EXPOSE 5000

# Default command: run the demo web app
CMD ["python", "demo/app.py"]
