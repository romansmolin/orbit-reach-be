# Easy Post Backend

Backend for the Easy Post SaaS platform. It exposes an Express API, coordinates social media publishing workflows, and executes background jobs with BullMQ-based workers.

## Architecture
- **API service** – `src/index.ts` boots the Express app, configures routes, and publishes REST endpoints for account, user, and post management.
- **Workers service** – `src/worker.ts` launches BullMQ schedulers/workers that pull jobs from Redis, refresh social tokens, and push content to social platforms.
- **Service layer** – Assemblies in `src/config/services.config.ts` wire repositories, domain services, and cross-cutting helpers (logger, media uploader, error handlers).
- **Repositories** – PostgreSQL-backed data access in `src/repositories/**`; a shared `pg` pool lives in `src/db-connection.ts`.
- **Shared libraries** – Platform-specific logic for rate limiting, media processing, and BullMQ queues under `src/shared/lib/**`.
- **External dependencies** – PostgreSQL for persistence, Redis for BullMQ, AWS S3-compatible storage for media uploads, ffmpeg for video processing.

```
             +---------------+             +----------------+
             |   HTTP API    |  uses       |   Services &   |
    client ->| (Express)     |-----------> |   Repositories |
             +---------------+             +----------------+
                     |                                |
                     | schedules jobs                 V
                     |                        +---------------+
                     |                        |  BullMQ       |
                     V                        |  Schedulers & |
             +---------------+                |  Workers      |
             | Redis (BullMQ)|<---------------+---------------+
             +---------------+
                     |
                     V
             +---------------+
             | PostgreSQL    |
             +---------------+
```

## Local Development

### Prerequisites
- Node.js 20.x and npm
- PostgreSQL and Redis instances
- ffmpeg installed locally (macOS: `brew install ffmpeg`; Ubuntu: `sudo apt install ffmpeg`)
- `.env` file with the required environment variables (see `.env.example` or existing `.env`)

### Steps
1. Install dependencies:
   ```bash
   npm ci
   ```
2. Apply database migrations if needed:
   ```bash
   npm run migrate
   ```
3. Start the HTTP API (with automatic reload via Nodemon):
   ```bash
   npm run dev
   ```
4. In a separate terminal, start the BullMQ workers:
   ```bash
   npm run dev:worker
   ```

Production builds:
```bash
npm run build
npm run start         # runs dist/index.js
npm run start:worker  # runs dist/worker.js
```

## Docker

The project ships a multi-stage Dockerfile with separate targets for the API and worker processes. Both stages share the same compiled code and production node_modules.

### Build images
```bash
docker build --target api -t easy-post-api .
docker build --target worker -t easy-post-worker .
```

### Run containers
Provide your environment variables via an `.env` file or explicit `-e` flags.

```bash
# API server on port 4000
docker run --rm --env-file .env -p 4000:4000 easy-post-api

# BullMQ workers
docker run --rm --env-file .env easy-post-worker
```

Ensure the containers can reach PostgreSQL, Redis, and any external services referenced in your configuration (e.g., AWS S3). In Coolify or similar platforms, register two services, selecting the `api` or `worker` Dockerfile target respectively.
