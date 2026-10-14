# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:24-alpine
RUN apk add --no-cache python3 py3-pip py3-requests && \
    pip3 install python-dotenv requests anthropic tqdm icalendar reportlab --break-system-packages
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend-builder /frontend/dist ./public
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "server.js"]
