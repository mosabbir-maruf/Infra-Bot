# Security & Authentication Guide

Security is a primary concern for the Infrastructure Control Plane, as compromised access allows arbitrary VM destruction and power operations.

## Authentication Model

### 1. Webhook Request Source Validation
To prevent attackers from sending spoofed HTTP POST payloads directly to the Worker's public URL, configure a webhook secret token:
* **Header**: Telegram Bot API includes the header `X-Telegram-Bot-Api-Secret-Token` on all webhook requests.
* **Verification**: The Worker matches this header against the `TELEGRAM_WEBHOOK_SECRET` environment binding.
* **Policy**: Requests with missing or non-matching tokens are blocked instantly at the edge with a `403 Forbidden` response, preventing unauthorized command routing overhead.

### 2. Whitelisted User Access
Only Telegram user IDs explicitly registered in the environment variables can execute commands.
```typescript
// src/telegram/middleware/AuthMiddleware.ts
const authorized = env.AUTHORIZED_USER_IDS.includes(userId);
```

### Rationale for Silent Drop
When an unauthorized message is received by the webhook, the Control Plane:
1. Logs the incident at `WARN` level containing the offender's Telegram user ID and message body.
2. Returns a `200 OK` response status code back to Telegram.
3. Does **NOT** reply to the Telegram chat.

By silently dropping unauthorized updates and returning `200 OK`, we:
* Prevent Telegram from retrying the webhook payload.
* Avoid exposing the existence of the bot to scanners, preventing bot reconnaissance and fingerprinting.

## Secret Management

Secrets must **never** be hardcoded or committed to git. All credentials are bound at runtime using Cloudflare Secrets.

### Required Secrets

| Secret Key | Description | Example |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token generated via BotFather | `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` |
| `AUTHORIZED_USER_IDS` | Comma-separated whitelisted User IDs | `987654321,123456789` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token configured on Telegram Webhook | `your_secure_webhook_secret_token` |
| `AWS_ACCESS_KEY_ID` | IAM User Access Key for EC2 access | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | IAM User Secret Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `DIGITALOCEAN_TOKEN` | Read/Write Personal Access Token | `dop_v1_abcdef123456...` |
| `MONITORING_SECRET` | Shared HMAC key for telemetries signature | `hmac_secret_key_here` |

### Setting Secrets Locally
For local development, create a `.dev.vars` file in the root directory (this file is gitignored):
```bash
TELEGRAM_BOT_TOKEN="your_token"
AUTHORIZED_USER_IDS="123456789,987654321"
TELEGRAM_WEBHOOK_SECRET="your_webhook_secret"
AWS_ACCESS_KEY_ID="aws_key"
AWS_SECRET_ACCESS_KEY="aws_secret"
DIGITALOCEAN_TOKEN="do_token"
MONITORING_SECRET="hmac_secret"
```

### Setting Secrets in Cloudflare Workers
Upload secrets to Cloudflare using wrangler CLI:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put AUTHORIZED_USER_IDS
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put DIGITALOCEAN_TOKEN
npx wrangler secret put MONITORING_SECRET
```

## Rate Limiting

To mitigate Denial of Service (DoS) attacks from whitelisted/compromised accounts or bot flooding, a distributed rate limiter middleware is enabled on the `/webhook` endpoint.
* **Limit**: 10 command executions per minute per user ID.
* **Storage**: Integrates with Cloudflare KV (`RATE_LIMIT_KV` binding) for distributed, multi-region tracking. Falls back to memory map in isolated dev environments.
