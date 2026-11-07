FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-crosextra-carlito ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/server/db ./server/db
COPY --from=build /app/server/pdf ./server/pdf
RUN python3 -m venv /opt/resume-pdf && /opt/resume-pdf/bin/pip install --no-cache-dir -r server/pdf/requirements.txt
ENV NODE_ENV=production
ENV LIBREOFFICE_BIN=/usr/bin/soffice
ENV RESUME_PDF_PYTHON=/opt/resume-pdf/bin/python3
USER node
CMD ["node", "dist/server/index.mjs"]
