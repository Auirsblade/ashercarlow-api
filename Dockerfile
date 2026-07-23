# syntax=docker/dockerfile:1

# ---- Stage 1: install + build all frontends ---------------------------------
FROM oven/bun:1 AS builder
WORKDIR /app

# Workspace manifests first so the install layer caches well
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/resume/package.json ./apps/resume/
COPY apps/wedding/package.json ./apps/wedding/
COPY apps/starwars/package.json ./apps/starwars/
COPY apps/swdnd/package.json ./apps/swdnd/

RUN bun install --frozen-lockfile

# Now the rest of the source
COPY apps/ ./apps/

# Optional override for the starwars app's API base URL.
# Defaults to the prod API; pass --build-arg VITE_API_BASE=http://localhost:3000
# (or any other reachable URL) for local Docker testing.
ARG VITE_API_BASE=https://api.ashercarlow.com
ENV VITE_API_BASE=${VITE_API_BASE}

# Build the four frontends
RUN cd apps/resume   && bun run build && cd ../.. \
 && cd apps/wedding  && bun run build && cd ../.. \
 && cd apps/starwars && bun run build && cd ../.. \
 && cd apps/swdnd    && bun run build && cd ../..

# Build the sw5e reference-content seed DB from the pinned upstream commit so every
# deploy self-seeds an empty data volume (see apps/backend/src/db/swdnd/seed.ts).
# Override the content version with --build-arg SW5E_REF=<commit>.
ARG SW5E_REF=beab2383231e3ac43ea251eae11570a5f6fc79c5
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git init vendor/sw5e \
 && git -C vendor/sw5e remote add origin https://github.com/sw5e-foundry/sw5e.git \
 && git -C vendor/sw5e fetch --depth 1 origin ${SW5E_REF} \
 && git -C vendor/sw5e checkout FETCH_HEAD \
 && mkdir -p /app/seed \
 && SWDND_DB_PATH=/app/seed/swdnd.sqlite SW5E_PACKS_DIR=vendor/sw5e/packs \
      bun run apps/backend/src/db/import/sw5e-import.ts

# ---- Stage 2: lean runtime image -------------------------------------------
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Re-install with --production so devDeps (Vite, TypeScript, vue-tsc, etc.) are skipped
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/resume/package.json ./apps/resume/
COPY apps/wedding/package.json ./apps/wedding/
COPY apps/starwars/package.json ./apps/starwars/
COPY apps/swdnd/package.json ./apps/swdnd/
RUN bun install --production --frozen-lockfile

# Backend source (includes migrations under src/db/migrations)
COPY apps/backend/src ./apps/backend/src

# Baked-in sw5e reference content; boot self-seeds it into the data volume if empty
# or out of date. Lives outside /app/data so it ships in the image, not the volume.
COPY --from=builder /app/seed/swdnd.sqlite ./seed/swdnd.sqlite
ENV SWDND_SEED_PATH=/app/seed/swdnd.sqlite

# Built frontend assets from the builder stage
COPY --from=builder /app/apps/resume/dist ./apps/resume/dist
COPY --from=builder /app/apps/wedding/dist ./apps/wedding/dist
COPY --from=builder /app/apps/starwars/dist ./apps/starwars/dist
COPY --from=builder /app/apps/swdnd/dist ./apps/swdnd/dist

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# SQLite database persists across deploys
VOLUME ["/app/data"]

CMD ["bun", "apps/backend/src/index.ts"]
