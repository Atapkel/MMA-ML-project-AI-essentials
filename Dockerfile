FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY arena/ arena/
COPY web/ web/
COPY models/ models/
RUN mkdir -p data
EXPOSE 8000
# Render (and most hosts) pass the port in $PORT; proxy headers make the QR link use https.
CMD ["sh", "-c", "uvicorn arena.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
