FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 \
    ARENA_DB=/app/data/arena.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY arena/ arena/
COPY web/ web/
COPY models/ models/
# run as an unprivileged user; data/ holds the SQLite database (mount a volume there to keep rooms across restarts)
RUN useradd --system --uid 10001 arena && mkdir -p data && chown arena:arena data
USER arena
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"
# Hosts pass the port in $PORT; proxy headers make the QR link use https behind a proxy (Caddy, Render, App Platform).
CMD ["sh", "-c", "exec uvicorn arena.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
