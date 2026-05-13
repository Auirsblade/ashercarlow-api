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

RUN bun install --frozen-lockfile

# Now the rest of the source
COPY apps/ ./apps/

# Optional override for the starwars app's API base URL.
# Defaults to the prod API; pass --build-arg VITE_API_BASE=http://localhost:3000
# (or any other reachable URL) for local Docker testing.
ARG VITE_API_BASE=https://api.ashercarlow.com
ENV VITE_API_BASE=${VITE_API_BASE}

# Build the three frontends
RUN cd apps/resume   && bun run build && cd ../.. \
 && cd apps/wedding  && bun run build && cd ../.. \
 && cd apps/starwars && bun run build && cd ../..

# ---- Stage 2: lean runtime image -------------------------------------------
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Re-install with --production so devDeps (Vite, TypeScript, vue-tsc, etc.) are skipped
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/resume/package.json ./apps/resume/
COPY apps/wedding/package.json ./apps/wedding/
COPY apps/starwars/package.json ./apps/starwars/
RUN bun install --production --frozen-lockfile

# Backend source (includes migrations under src/db/migrations)
COPY apps/backend/src ./apps/backend/src

# Built frontend assets from the builder stage
COPY --from=builder /app/apps/resume/dist ./apps/resume/dist
COPY --from=builder /app/apps/wedding/dist ./apps/wedding/dist
COPY --from=builder /app/apps/starwars/dist ./apps/starwars/dist

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# SQLite database persists across deploys
VOLUME ["/app/data"]

CMD ["bun", "apps/backend/src/index.ts"]
