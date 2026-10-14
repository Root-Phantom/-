# ---------- مرحله ۱: ساخت رابط کاربری (React/Vite) ----------
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------- مرحله ۲: بک‌اند (Python/FastAPI) + رابط کاربری ساخته‌شده ----------
FROM python:3.12-slim AS backend
WORKDIR /app/backend

ENV PYTHONUTF8=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/app ./app

# رابط کاربری باید کنار backend/ (یعنی در ../frontend/dist) قرار بگیرد؛ main.py همین مسیر را سرو می‌کند
COPY --from=frontend-build /frontend/dist /app/frontend/dist

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
