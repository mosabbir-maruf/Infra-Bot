# Infrastructure Bot

A production-grade, highly available, and secure Infrastructure Control Plane built on Cloudflare Workers, TypeScript, and the Telegram Bot API, combined with a lightweight Linux VPS telemetry monitoring agent.

---

## ⚡ Primary Architecture

The system operates serverless at the edge, guaranteeing that the control pathways remain fully active and decoupled even if the managed servers are completely powered down or experiencing network failures.

```
                  ┌───────────────────────┐
                  │     Telegram User     │
                  └───────────┬───────────┘
                              │ Commands & Replies
                  ┌───────────▼───────────┐
                  │   Telegram Bot API    │
                  └───────────┬───────────┘
                              │ Webhook (POST /webhook)
                  ┌───────────▼───────────┐
                  │  Cloudflare Workers   │◄──────────────┐
                  │     Control Plane     │               │ Telemetry Ingestion
                  └──────┬─────────┬──────┘               │ (POST /monitoring/report)
                         │         │                      │ (HMAC-SHA256 Signed)
            ┌────────────┘         └────────────┐         │
  ┌─────────▼──────────┐              ┌─────────▼────────┐│   ┌──────────────────────┐
  │  AWS EC2 Adapter   │              │  DigitalOcean    │└───┤ VPS Telemetry Agent │
  └─────────┬──────────┘              │  Droplet Adapter │    │   (monitoring/      │
            │                         └─────────┬────────┘    │    agent.sh)         │
            │ REST/SDK                          │ REST        └──────────────────────┘
  ┌─────────▼──────────┐              ┌─────────▼────────┐
  │ AWS EC2 Instances  │              │  DO Droplets     │
  └────────────────────┘              └──────────────────┘
```

---

## 🌟 Key Features

* **Multi-Provider Support**: Built-in adapters for AWS EC2 and DigitalOcean Droplets.
* **Unified Command Interface**: Commands resolved using server aliases rather than raw IDs (e.g. `/status ai-gateway-prod`).
* **Decoupled Architecture**: Query state, trigger reboots, starts, and stops directly via cloud provider APIs.
* **Robust Telemetry**: A lightweight, dependency-free Linux Bash agent reporting CPU, RAM, Disk, Uptime, Docker container status, and vnStat monthly bandwidth usage.
* **HMAC Security**: Telemetry data is cryptographically signed with HMAC-SHA256 and protected against replay attacks using timestamp verification.
* **Rate Limiting**: Distributed rate limiter powered by Cloudflare KV.
* **Automatic Reporting**: Daily cron triggers that push comprehensive infrastructure health digests to authorized Telegram operators.

---

## 📂 Project Directory Structure

```text
infra-bot/
├── .eslintrc.json           # Code quality rules
├── .prettierrc              # Code formatting rules
├── .env.example             # Template for secrets and variables
├── package.json             # Build and test dependencies
├── tsconfig.json            # Strict TypeScript compiler options
├── wrangler.toml            # Cloudflare Workers configuration
├── docs/                    # Architectural and integration docs (see Documentation Index)
├── monitoring/
│   └── agent.sh             # Portable VPS telemetry bash script
├── src/                     # Cloudflare Worker source code
│   ├── index.ts             # Entry point, HTML router, and cron handler
│   ├── config/              # Server configuration and environment validators
│   ├── core/                # Unified provider interfaces
│   ├── middleware/          # Rate limiting middleware
│   ├── providers/           # AWS and DigitalOcean adapter implementations
│   ├── telegram/            # Telegram client, webhook router, and command handlers
│   ├── types/               # Strict TypeScript interface declarations
│   └── utils/               # Cryptography, logging, and error utilities
└── tests/                   # Complete Vitest test suite
    ├── Auth.test.ts         # User authorization rules tests
    ├── HttpRouter.test.ts   # Edge HTTP routing integration tests
    ├── Monitoring.test.ts   # Telemetry HMAC signature tests
    ├── Providers.test.ts    # AWS/DO mock response parsing tests
    └── Router.test.ts       # Telegram command routing tests
```

### 📖 Documentation Index

The following guides are available in the [docs/](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs) directory:

* **Architecture Overview**: [docs/architecture/overview.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/architecture/overview.md)
* **Security & Auth Rules**: [docs/security/authentication.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/security/authentication.md)
* **AWS Integration Guide**: [docs/providers/aws.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/providers/aws.md)
* **DigitalOcean Integration**: [docs/providers/digitalocean.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/providers/digitalocean.md)
* **Deployment Guide**: [docs/operations/deployment.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/operations/deployment.md)
* **Disaster Recovery Playbook**: [docs/recovery/disaster-recovery.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/recovery/disaster-recovery.md)
* **Telemetry Monitoring Architecture**: [docs/monitoring/architecture.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/monitoring/architecture.md)
* **Telemetry Agent Setup**: [docs/monitoring/agent.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/monitoring/agent.md)
* **Telemetry Bandwidth Alerts**: [docs/monitoring/alerts.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/monitoring/alerts.md)
* **Telemetry Recovery Runbook**: [docs/monitoring/recovery.md](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/docs/monitoring/recovery.md)

---

## ⚙️ Environment Configuration

To run the Control Plane, copy `.env.example` to `.dev.vars` (for local development) or configure secrets in Cloudflare:

```bash
# Set a secret in Cloudflare
npx wrangler secret put <SECRET_NAME>
```

### Configuration Parameters

| Variable Name | Type | Description | Example |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret | Token issued by Telegram's BotFather | `123456789:ABCdef...` |
| `AUTHORIZED_USER_IDS`| Secret | Comma-separated list of Telegram user IDs authorized to run commands | `123456789,987654321` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | Optional secret token to verify webhook source authenticity | `webhook_secret_here` |
| `AWS_ACCESS_KEY_ID` | Secret | Restricted AWS IAM access key ID | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY`| Secret | Restricted AWS IAM secret access key | `wJalrXUtnFEMI/K7MDEN...` |
| `AWS_REGION` | Secret | Default fallback AWS region | `us-east-1` |
| `DIGITALOCEAN_TOKEN` | Secret | Personal access token with read/write scopes | `dop_v1_abcdef...` |
| `SERVERS_CONFIG` | Binding| JSON mapping server aliases to cloud provider IDs | *See below* |
| `MONITORING_SECRET` | Secret | Shared HMAC key for verifying telemetry payloads | `secure_secret_here` |

### Server Registry Configuration (`SERVERS_CONFIG`)

Configure the target servers in the registry JSON schema:

```json
{
  "ai-gateway-prod": {
    "provider": "aws",
    "region": "ap-south-1",
    "instanceId": "i-0123456789abcdef0"
  },
  "docs-server": {
    "provider": "digitalocean",
    "dropletId": "123456789"
  }
}
```

---

## 🛠️ Local Development & Testing

### 1. Installation

Install all required modules and CLI tools:
```bash
npm install
```

### 2. Run Tests

Execute the Vitest test suite covering authorization, adapters, routing, and HTTP endpoints:
```bash
npm run test
```

### 3. Lint & Format check

Ensure code format compliance with ESLint and Prettier rules:
```bash
npm run lint
npm run format
```

### 4. Run Dev Server

Start Wrangler's local development server to test HTTP routing:
```bash
npm run dev
```

---

## 🚀 Telemetry Agent Setup

To hook a Linux VPS into the telemetry monitoring pipeline:

1. Copy the portable telemetry script [agent.sh](monitoring/agent.sh) to the target server.
2. Ensure `vnstat` and `curl` are installed:
   ```bash
   sudo apt-get install vnstat curl -y
   ```
3. Set up a systemd service or a cron job executing the agent periodically:
   ```bash
   # Execute agent every 5 minutes and sign with your HMAC secret
   */5 * * * * SERVER_ALIAS="ai-gateway-prod" MONITORING_SECRET="your_shared_secret" CONTROL_PLANE_URL="https://your-worker.workers.dev" /usr/local/bin/agent.sh
   ```
