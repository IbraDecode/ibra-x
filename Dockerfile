# ==========================================================================
# Ibra X — container
# ==========================================================================
FROM node:22-slim

# Alat build untuk modul native (better-sqlite3) bila tak ada prebuilt.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages ./packages
COPY skills ./skills
COPY tsconfig.json ./

RUN npm install --omit=dev || npm install

ENV IBRA_DATA_DIR=/data
ENV IBRA_HOST=0.0.0.0
VOLUME ["/data"]

EXPOSE 8787

CMD ["npm", "run", "start"]
