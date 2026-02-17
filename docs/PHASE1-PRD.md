# Phase 1 PRD: Multi-User Deployment

**Goal:** Transform Mission Clawtrol from a single-user local tool into a deployable multi-user service suitable for a 10-person tech startup on AWS/GitHub.

**Timeline:** 2-3 weeks
**Status:** In Progress

---

## 1. GitHub OAuth Authentication

### Requirements
- Users authenticate via GitHub OAuth (the team already uses GitHub)
- On first login, a user record is created automatically
- Session management via secure HTTP-only cookies (JWT or session tokens)
- Backend API rejects unauthenticated requests (except `/api/health`)
- Dashboard redirects to GitHub login if no session
- Support for a configurable `ALLOWED_ORG` env var — only members of that GitHub org can log in

### User Model
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- UUID
  githubId INTEGER UNIQUE NOT NULL,
  githubLogin TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatarUrl TEXT,
  role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member' | 'viewer'
  createdAt TEXT NOT NULL,
  lastLoginAt TEXT
);
```

### Roles (Phase 1 — keep simple)
| Role | Can do |
|------|--------|
| **admin** | Everything: manage users, settings, agents, approve all |
| **member** | Create/manage tasks, spawn agents, approve own project tasks |
| **viewer** | Read-only dashboard access |

The first user to log in becomes `admin`. Subsequent users default to `member`.

### Implementation Notes
- Use `@fastify/oauth2` for the OAuth flow
- Use `@fastify/cookie` + `@fastify/session` (or signed JWT in cookie)
- GitHub OAuth app: callback URL = `https://<domain>/api/auth/callback`
- Store GitHub access token per user (needed for Phase 2 GitHub API calls)
- Add `userId` column to tasks table for "created by" tracking

### API Changes
- `GET /api/auth/login` → Redirect to GitHub OAuth
- `GET /api/auth/callback` → Handle OAuth callback, create/update user, set session
- `GET /api/auth/me` → Return current user info
- `POST /api/auth/logout` → Clear session
- All other routes: require valid session (401 if missing)

### Dashboard Changes
- Add login page (simple "Sign in with GitHub" button)
- Show current user avatar + name in header
- Add user menu with logout option
- Pass session cookie with all API requests (credentials: 'include')

---

## 2. PostgreSQL Migration

### Requirements
- Replace SQLite with PostgreSQL (AWS RDS compatible)
- Maintain all existing schema + data
- Support connection via `DATABASE_URL` env var
- Keep SQLite as fallback for local dev (`DATABASE_URL` not set → use SQLite)

### Schema Changes
- All existing tables migrate as-is (tasks, settings)
- Add `users` table (above)
- Add `userId` to `tasks` table (nullable for backward compat)
- Add `audit_log` table for tracking state changes

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES users(id),
  action TEXT NOT NULL,        -- 'task.created', 'task.status_changed', 'approval.resolved', etc.
  entityType TEXT,             -- 'task', 'project', 'approval'
  entityId TEXT,
  details JSONB,               -- Flexible payload
  createdAt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_log_entity ON audit_log(entityType, entityId);
CREATE INDEX idx_audit_log_user ON audit_log(userId);
```

### Implementation Notes
- Use `pg` (node-postgres) with a connection pool
- Abstract the DB layer behind an interface so SQLite and Postgres share the same API
- Migration script: read from SQLite, write to Postgres (one-time)
- Use parameterized queries (already doing this with better-sqlite3, same pattern for pg)

### Database Abstraction Layer
```typescript
interface Database {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ changes: number }>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
```

Two implementations: `SqliteDatabase` (existing, refactored) and `PostgresDatabase` (new).
Factory function checks `DATABASE_URL` → returns appropriate implementation.

---

## 3. Dockerization

### Requirements
- Single `docker-compose.yml` that brings up: backend, dashboard, postgres
- Production-ready Dockerfiles (multi-stage builds, non-root user)
- Environment configuration via `.env` file
- Health checks for all services
- Volumes for Postgres data persistence

### Dockerfile — Backend
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY services/backend/package*.json ./
RUN npm ci
COPY services/backend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "dist/index.js"]
```

### Dockerfile — Dashboard
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY apps/dashboard/package*.json ./
RUN npm ci
COPY apps/dashboard/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER app
EXPOSE 5173
CMD ["node", "build"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: clawtrol
      POSTGRES_USER: clawtrol
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: pg_isready -U clawtrol
      interval: 5s
      retries: 5

  backend:
    build:
      context: .
      dockerfile: services/backend/Dockerfile
    environment:
      DATABASE_URL: postgres://clawtrol:${POSTGRES_PASSWORD}@postgres:5432/clawtrol
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      GATEWAY_URL: ${GATEWAY_URL:-ws://host.docker.internal:18789}
      GATEWAY_TOKEN: ${GATEWAY_TOKEN}
      ALLOWED_ORG: ${ALLOWED_ORG:-}
      PUBLIC_URL: ${PUBLIC_URL:-http://localhost:5173}
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy

  dashboard:
    build:
      context: .
      dockerfile: apps/dashboard/Dockerfile
    environment:
      PUBLIC_API_URL: ${PUBLIC_API_URL:-http://localhost:3001}
    ports:
      - "5173:5173"
    depends_on:
      - backend

volumes:
  pgdata:
```

### Environment Variables
```env
# Required
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SESSION_SECRET=           # Random 32+ char string
POSTGRES_PASSWORD=        # DB password

# Optional
GATEWAY_URL=ws://host.docker.internal:18789
GATEWAY_TOKEN=
ALLOWED_ORG=             # GitHub org name to restrict access
PUBLIC_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:3001
```

---

## 4. Task Breakdown

| # | Task | Agent | Priority | Estimate |
|---|------|-------|----------|----------|
| 1 | Database abstraction layer (interface + SQLite impl refactor) | senior-dev | P1 | 4h |
| 2 | PostgreSQL implementation of DB interface | senior-dev | P1 | 4h |
| 3 | Users table + model | senior-dev | P1 | 2h |
| 4 | GitHub OAuth flow (backend) | senior-dev | P0 | 4h |
| 5 | Auth middleware (protect all routes) | senior-dev | P0 | 2h |
| 6 | Dashboard login page + auth flow | junior-dev | P1 | 3h |
| 7 | Dashboard user menu + session handling | junior-dev | P2 | 2h |
| 8 | Audit log table + logging middleware | junior-dev | P2 | 3h |
| 9 | Backend Dockerfile (multi-stage) | junior-dev | P1 | 2h |
| 10 | Dashboard Dockerfile (multi-stage) | junior-dev | P1 | 2h |
| 11 | docker-compose.yml + env template | junior-dev | P1 | 2h |
| 12 | Migration script (SQLite → Postgres) | senior-dev | P1 | 3h |
| 13 | Integration testing + smoke tests | senior-dev | P1 | 3h |

---

## 5. Success Criteria

- [ ] Team members can log in via GitHub OAuth
- [ ] Unauthorized users get 401, not data
- [ ] Tasks, projects, costs all work identically on Postgres
- [ ] `docker-compose up` brings the full stack up from scratch
- [ ] Existing functionality (task CRUD, kanban, cost tracking, approvals, WebSocket) works unchanged
- [ ] Audit log captures task state changes with user attribution
