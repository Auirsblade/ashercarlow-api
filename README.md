# ashercarlow-api

> A NestJS-powered API serving as the backend infrastructure for ashercarlow projects and various utility endpoints.

[![Built with NestJS](https://img.shields.io/badge/Built%20with-NestJS-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20Mode-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)

## About

This API serves as the centralized backend for all things **ashercarlow**—from core application services to miscellaneous endpoints I wanted deployed and accessible. It's also a hands-on learning project for exploring NestJS patterns, TypeScript best practices, and modern API development.

### Why This Exists

- **Backend Infrastructure**: Powers various ashercarlow projects and services
- **Utility Endpoints**: A collection of useful endpoints for personal projects
- **Learning Platform**: Experimenting with NestJS architecture, dependency injection, and TypeScript
- **Production-Ready**: Docker deployment with Dokploy, Swagger documentation, and strict TypeScript

## Features

- **OpenAPI/Swagger Documentation**: Interactive API docs at `/api`
- **TypeScript Strict Mode**: Type-safe code with full type checking
- **Docker Support**: Multi-stage builds optimized for production
- **Hot Reload**: Fast development with automatic reloading
- **Testing Suite**: Unit, e2e, and coverage testing configured
- **Code Quality**: ESLint and Prettier for consistent code style

## Current Endpoints

### Music Metadata

Retrieve cross-platform music links and metadata from various streaming services.

- **Universal Links**: Get links across Spotify, Apple Music, YouTube, and more using the [Odesli API](https://odesli.co/)
- **Spotify Metadata**: Scrape track/album/artist metadata from Spotify URLs (no auth required)

More endpoints coming as the project grows.

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm or yarn
- Docker (optional, for containerized deployment)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ashercarlow-api.git
cd ashercarlow-api

# Install dependencies
npm install
```

### Development

```bash
# Start with hot reload
npm run start:dev

# Start with debugger attached
npm run start:debug

# Run tests in watch mode
npm run test:watch
```

The API will be available at `http://localhost:3000`
Swagger documentation at `http://localhost:3000/api`

### Building for Production

```bash
# Build the project
npm run build

# Run production build
npm run start:prod
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker compose up --build

# Or build the Docker image directly
docker build -t ashercarlow-api .
docker run -p 3000:3000 ashercarlow-api
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start development server with hot reload |
| `npm run start:debug` | Start with debugger attached |
| `npm run build` | Build to `dist/` directory |
| `npm run start:prod` | Run production build |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Lint and auto-fix with ESLint |
| `npm run format` | Format code with Prettier |

## Project Structure

```
src/
├── main.ts           # Application bootstrap with Swagger setup
├── app.module.ts     # Root module
├── music/            # Music module (Odesli API + Spotify scraping)
└── ...               # Additional modules as they're added
```

## API Documentation

This project uses Swagger/OpenAPI for interactive API documentation. The Swagger CLI plugin automatically extracts metadata from DTOs and controllers.

Access the Swagger UI at: **`http://localhost:3000/api`**

## Tech Stack

- **[NestJS](https://nestjs.com/)**: Progressive Node.js framework
- **[TypeScript](https://www.typescriptlang.org/)**: Strict mode enabled
- **[Swagger/OpenAPI](https://swagger.io/)**: API documentation
- **[Docker](https://www.docker.com/)**: Containerization
- **[Dokploy](https://dokploy.com/)**: Deployment platform

## Deployment

This project uses a multi-stage Dockerfile optimized for production deployments. Configured for Dokploy, which can use either `docker-compose.yml` or `Dockerfile` directly.

## Contributing

This is a personal learning project, but suggestions and ideas are welcome. Feel free to open an issue if you spot something interesting.

## License

MIT
