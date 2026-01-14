# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS API with TypeScript (strict mode), OpenAPI/Swagger documentation, and Docker deployment support for Dokploy.

## Commands

```bash
# Development
npm run start:dev      # Start with hot reload
npm run start:debug    # Start with debugger attached

# Build & Production
npm run build          # Build to dist/
npm run start:prod     # Run production build

# Testing
npm test               # Run unit tests
npm run test:watch     # Run tests in watch mode
npm run test:cov       # Run tests with coverage
npm run test:e2e       # Run e2e tests

# Code Quality
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting

# Docker
docker compose up --build    # Build and run container
```

## Architecture

- **src/main.ts**: Application bootstrap with Swagger setup at `/api`
- **src/app.module.ts**: Root module
- **src/music/**: Music module for fetching cross-platform links and metadata
  - Uses [Odesli API](https://odesli.co/) for universal music links
  - Uses [spotify-url-info](https://github.com/microlinkhq/spotify-url-info) for Spotify metadata scraping (no auth required)

## Swagger

The Swagger CLI plugin is enabled in `nest-cli.json`, which automatically extracts API metadata from DTOs and controllers. Access the Swagger UI at `http://localhost:3000/api`.

## Deployment

Multi-stage Dockerfile optimized for production. Dokploy will use `docker-compose.yml` or `Dockerfile` directly.
