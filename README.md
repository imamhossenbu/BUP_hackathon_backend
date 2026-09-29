# Fuel Supply Intelligence Backend (NestJS)
**Platform Core — BUP CSE Fest 2026 Hackathon Finals**

[![NestJS](https://img.shields.io/badge/NestJS-10.3-red?style=flat-square&logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.9-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Opossum](https://img.shields.io/badge/Circuit%20Breaker-Opossum-brightgreen?style=flat-square)](https://github.com/nodeshift/opossum)

---

## 1. Overview & Architectural Role

The **Fuel Intelligence Backend** acts as the resilient brain of the platform. It executes continuous telemetry polling, applies machine learning demand forecasts, computes digital twin risk curves, pre-validates distribution policies, and provides idempotent dispatch controls to human operators.

### Key Capabilities
- **Resilient Simulator Client:** Integrates with the BUP Fuel Simulator via Axios with exponential backoff and an Opossum Circuit Breaker.
- **Zod Pre-Validation:** Validates 100% of runtime incoming and outgoing schemas.
- **Digital Twin Risk Core:** Calibrates baseline demand against live consumption residuals and executes 200-run Monte Carlo simulations.
- **Constrained Decision Optimizer:** Generates emergency allocations (Policy A: fastest arrival; Policy B: supply preservation) with 10-point constraint validation.
- **Audit Logging:** Every recommendation approval, rejection, and manual dispatch is immutably recorded in PostgreSQL via Prisma.
- **Bilingual Briefing Engine:** Synthesizes instant dual-language operational summaries (English & বাংলা) and powers the Operator Copilot.

---

## 2. Directory Layout

```
backend/
├── src/
│   ├── ai/                      # Bilingual briefing & Copilot service
│   │   ├── ai.controller.ts     # GET /api/ai/briefing, POST /api/ai/copilot
│   │   ├── ai.service.ts        # Live telemetry synthesis & Bengali translator
│   │   └── ai.module.ts
│   │
│   ├── decision/                # Constrained dispatch & pre-validation engine
│   │   ├── decision.controller.ts # Recommendation approvals & audit history
│   │   ├── decision.service.ts  # Policy A / B heuristics & priority ranking
│   │   ├── policy-rule.ts       # Route transit & depot selection logic
│   │   ├── prevalidate.ts       # 10-step feasibility validator
│   │   └── decision.module.ts
│   │
│   ├── forecast/                # Demand forecasting & ML client
│   │   ├── forecast.service.ts  # Rolling residual correction & stockout matrix
│   │   ├── baseline.ts          # Hourly diurnal consumption curves
│   │   ├── residual.ts          # EWMA residual & volatility tracker
│   │   ├── stockout.ts          # 200-run Monte Carlo digital twin
│   │   ├── ml.client.ts         # REST bridge to Python FastAPI ML service
│   │   └── forecast.module.ts
│   │
│   ├── health/                  # System liveness & circuit breaker health
│   │   ├── health.controller.ts # GET /health
│   │   └── health.module.ts
│   │
│   ├── prisma/                  # Relational persistence & audit schema
│   │   ├── prisma.service.ts    # Prisma client lifecycle
│   │   └── prisma.module.ts
│   │
│   ├── simulator/               # Resilient simulator poller & client
│   │   ├── simulator.client.ts  # Axios client with circuit breaker & retry
│   │   ├── simulator.poller.ts  # Periodic tick synchronization loop
│   │   ├── simulator.schemas.ts # Zod validation schemas
│   │   ├── simulator.errors.ts  # Custom typed exceptions
│   │   └── simulator.module.ts
│   │
│   ├── config/                  # Validated environment configuration
│   ├── app.module.ts            # Root application module
│   └── main.ts                  # Application bootstrap entrypoint
│
├── prisma/
│   └── schema.prisma            # PostgreSQL models for decisions & audit trail
├── Dockerfile                   # Production container definition
├── package.json
└── tsconfig.json
```

---

## 3. REST API Specifications

### Health & Monitoring
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Full system health: backend, database, simulator, circuit breaker |

### Simulator State & Telemetry
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/snapshot` | Latest cached network snapshot (depots, stations, routes, metrics) |
| `POST` | `/api/simulator/control/step` | Advances the simulator forward by 1 tick |
| `POST` | `/api/simulator/control/run` | Resumes automated simulator ticking |
| `POST` | `/api/simulator/control/pause` | Pauses simulator progression |
| `POST` | `/api/simulator/control/reset` | Resets simulator state back to Tick 0 |
| `POST` | `/api/simulator/control/fault` | Injects chaos faults (`latency`, `error_rate`, `stale_data`, etc.) |
| `POST` | `/api/simulator/control/allocate`| Submits manual operator allocation with strict idempotency |

### Forecasting & Machine Learning
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/forecast` | Station-fuel forecasts with hours-to-stockout and Monte Carlo quantiles |
| `GET` | `/api/forecast/urgent` | Filtered list of CRITICAL and HIGH severity station-fuel pairs |
| `GET` | `/api/forecast/ml/status` | ML service connectivity and XGBoost regression metrics |
| `POST` | `/api/forecast/ml/retrain` | Triggers background dataset collection and model retraining |

### Decision Engine & Dispatches
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/recommendations` | Active AI-generated dispatch recommendations |
| `POST` | `/api/recommendations/generate` | Force re-evaluates urgency matrix and generates new recommendations |
| `POST` | `/api/recommendations/:id/approve` | Approves recommendation and dispatches tanker to simulator |
| `POST` | `/api/recommendations/:id/reject` | Rejects recommendation with recorded operator rationale |
| `GET` | `/api/recommendations/history` | Paginated immutable decision audit log |

### Bilingual AI & Copilot
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ai/briefing` | Dual-language operational summary (`summaryEn` & `summaryBn`) |
| `POST` | `/api/ai/copilot` | Natural language query grounded in live network telemetry |

---

## 4. Environment Configuration

Configure via `.env` file in the `backend/` directory:

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `4000` | Port for NestJS backend HTTP server |
| `SIMULATOR_BASE_URL` | `http://localhost:8000` | Address of BUP Fuel Supply Simulator |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `ML_SERVICE_URL` | `http://localhost:5000` | Address of Python XGBoost ML service |
| `POLL_INTERVAL_MS` | `3000` | Telemetry polling frequency (ms) |
| `SIM_TIMEOUT_MS` | `3000` | Max timeout for simulator HTTP requests |
| `MONTE_CARLO_RUNS` | `200` | Number of stochastic simulation iterations |
| `FORECAST_HORIZON_TICKS` | `96` | Forecast window (96 ticks = 24 hours) |
| `URGENCY_CRITICAL_HOURS` | `6` | Threshold for CRITICAL stockout classification |
| `URGENCY_HIGH_HOURS` | `12` | Threshold for HIGH stockout classification |
| `OPERATOR_TOKEN` | `fuel-operator-secret-2026` | Bearer token for privileged operator controls |

---

## 5. Development & Running

### Option A: Running via Docker (Recommended)
The backend is packaged as an optimized multi-stage Node 20 Alpine container with automated Prisma schema synchronization:

```bash
# 1. Build and launch backend (alongside dependencies) from root directory:
docker compose up -d --build backend

# 2. View live backend logs:
docker compose logs -f backend

# 3. Execute Prisma migrations inside the running container:
docker compose exec backend npx prisma db push

# 4. Open an interactive shell inside the container:
docker compose exec backend sh
```

#### Standalone Container Build:
```bash
# Build the Docker image manually:
docker build -t fuel-intelligence-backend .

# Run standalone container (with host networking or linked DB):
docker run -d \
  -p 4000:4000 \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5432/fuel?schema=public" \
  -e SIMULATOR_BASE_URL="http://host.docker.internal:8000" \
  -e ML_SERVICE_URL="http://host.docker.internal:5000" \
  --name fuel-backend \
  fuel-intelligence-backend
```

---

### Option B: Local Manual Setup

#### Prerequisites
- Node.js 18+ (tested on Node.js 20 & 24)
- PostgreSQL 14+ running locally or in Docker

#### Step-by-Step Execution
```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client & sync schema
npx prisma generate
npx prisma db push

# 3. Build TypeScript codebase
npm run build

# 4. Start production server
npm start

# Or run in development watch mode
npm run start:dev
```
