# Operations and Deployment Guide

This guide details the standard, dashboard-centric workflow for deploying the Infrastructure Bot to Cloudflare using Git integration, followed by local development and manual Wrangler CLI instructions for advanced use cases.

---

## 1. Cloudflare Dashboard Deployment (Git Integration)

This is the recommended deployment model. It automatically builds and deploys your worker whenever you push commits to your repository branch.

### Step 1: Fork and Clone
1. Fork this repository on GitHub.
2. Clone your fork locally for configuration and development.

### Step 2: Connect to Cloudflare Workers
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Navigate to **Workers & Pages** > **Create** > **Connect to Git** (or select **Workers & Pages** > **Create application** > **Create Worker** > configure Git later).
3. Connect your GitHub account, select your fork repository, and choose the branch you want to deploy (e.g., `main`).
4. Click **Deploy**. (The first build might complete, but the runtime will fail until you configure bindings and secrets in the next steps).

### Step 3: Create and Bind the KV Namespace
The worker uses a KV namespace named `MONITORING_KV` to store target server telemetry metrics.
1. In the Cloudflare Dashboard sidebar, go to **Workers & Pages** > **KV**.
2. Click **Create Namespace**, name it `mosabbir-infra-bot-MONITORING_KV` (or any custom name), and click **Add**.
3. Navigate back to **Workers & Pages** > select your worker service (`mosabbir-infra-bot`) > **Settings** > **Variables**.
4. Scroll down to **KV Namespace Bindings** and click **Add binding**.
5. Configure the binding:
   * **Variable name**: `MONITORING_KV` (This must match exactly in uppercase).
   * **KV namespace**: Select your newly created namespace from the dropdown.
6. Click **Save and Deploy**.

### Step 4: Configure Secrets & Variables

`wrangler.toml` defines only one plain-text **var** (`NODE_ENV`). `AWS_REGION` defaults to `us-east-1` in code and can be overridden as a plain-text Variable in the Dashboard. All other configuration must be added manually. You will need to create each entry, paste your value, and encrypt the sensitive ones.

To set your configuration:
1. In the Cloudflare Dashboard, select your worker > **Settings** > **Variables**.
2. Under **Variables & Secrets**, click **Add variable**.
3. Choose **Secret** for all items flagged as "Secret" in the table below.
4. Enter the variable name and value, then click **Add**.
5. Repeat for every required key in the table below.
6. Click **Save and Deploy**.

> [!IMPORTANT]
> **You must click the "Secret" option** (the lock icon) when adding sensitive credentials (bot tokens, API keys, provider secrets). Plain-text variables are visible in the Dashboard and logs. Secrets are write-only and encrypted at rest.

#### Environment Configuration Table:

| Key | Type | Required? | Description |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Secret | **Yes** | Your Telegram Bot token from `@BotFather`. |
| `AUTHORIZED_USER_IDS` | Secret | **Yes** | Comma-separated list of whitelisted Telegram User IDs. |
| `SERVERS_CONFIG` | Secret | **Yes** | JSON configuration string mapping server aliases to instances. See Server Registration below. |
| `MONITORING_SECRET` | Secret | **Yes** | Shared HMAC secret key used to verify telemetry reports. |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | No (Rec.) | Arbitrary secret header token to verify incoming webhook requests. |
| `AWS_ACCESS_KEY_ID` | Secret | No (Opt.) | AWS IAM User Access Key for EC2 integration. |
| `AWS_SECRET_ACCESS_KEY` | Secret | No (Opt.) | AWS IAM User Secret Key for EC2 integration. |
| `DIGITALOCEAN_TOKEN` | Secret | No (Opt.) | Personal Access Token for DigitalOcean integration. |
| `AWS_REGION` | Plain text | No (Opt.) | AWS region for EC2 API calls. Default: `us-east-1`. |
| `BANDWIDTH_ALERT_THRESHOLDS` | Secret | No (Opt.) | Comma-separated GB thresholds. Default: `50,80,95`. |

### Server Registration

The `SERVERS_CONFIG` JSON tells the bot which servers to manage. Each entry maps an alias (used in Telegram commands like `/status my-server`) to a cloud provider and instance identifier.

**DigitalOcean example:**
```json
{
  "docs-server": {
    "provider": "digitalocean",
    "dropletId": "123456789",
    "region": "nyc3"
  },
  "api-prod-01": {
    "provider": "digitalocean",
    "dropletId": "987654321"
  }
}
```

The `region` field is optional. If omitted, the dashboard shows `—` instead.

Optional `"bandwidthLimitGB": 500` adds a progress bar to `/bandwidth`. Bandwidth alerts fire regardless — configure thresholds via `BANDWIDTH_ALERT_THRESHOLDS` (defaults to `50,80,95`). Override the alert threshold at runtime with `/setbandwidth <alias> <GB|remove>` via Telegram (KV takes precedence over env config).

**AWS EC2 example:**
```json
{
  "ai-gateway-prod": {
    "provider": "aws",
    "region": "ap-south-1",
    "instanceId": "i-0123456789abcdef0"
  }
}
```

Only servers listed here will appear on the dashboard and be addressable by Telegram commands.

### How to Find Your Telegram Chat ID (User ID)
The `AUTHORIZED_USER_IDS` configuration requires your numeric Telegram User ID (which also serves as your private chat ID for telemetry reports and warnings). To find your ID:
* **Option A (Quickest)**: Search for `@userinfobot` or `@raw_data_bot` on Telegram and send it a message. The bot will immediately reply with your numeric ID (e.g., `987654321`).
* **Option B (Via API)**: Send a message to your newly created bot, then visit the following URL in your web browser:
  `https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/getUpdates`
  Look for the `message.from.id` or `message.chat.id` numeric value in the JSON response.

### Step 5: Register the Telegram Webhook
To route messages from Telegram to your worker:
1. Copy the production Worker URL displayed in your dashboard (e.g. `https://mosabbir-infra-bot.username.workers.dev`).
2. Register the webhook by sending an HTTP POST to the Telegram API:

```bash
curl -F "url=https://<YOUR-WORKER-SUBDOMAIN>.workers.dev/webhook" \
     -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```
*Note: Include the `secret_token` parameter only if you configured the `TELEGRAM_WEBHOOK_SECRET` secret.*

3. Verify response:
```json
{ "ok": true, "result": true, "description": "Webhook was set" }
```


---

## 2. Local Development

### 2.1 Configure Local Secrets
Wrangler reads local variables and secrets from a `.dev.vars` file in the project root. Create a `.dev.vars` file (gitignored):

```bash
TELEGRAM_BOT_TOKEN="123456:your_bot_token"
AUTHORIZED_USER_IDS="12345678,98765432"
MONITORING_SECRET="secure_shared_hmac_secret_key"
SERVERS_CONFIG='{"my-vm":{"provider":"digitalocean","dropletId":"12345"}}'
```

### 2.2 Run Wrangler Dev Server
Start the local server. Wrangler automatically mocks KV storage locally:
```bash
npm run dev
```

---

## 3. Wrangler CLI Deployment (Advanced / Alternative)

If you prefer deploying manually from your terminal using Wrangler CLI instead of Git integration:

1. Log in to the Cloudflare CLI:
   ```bash
   npx wrangler login
   ```
2. Create the KV namespace:
   ```bash
   npx wrangler kv namespace create MONITORING_KV
   ```
3. Copy the namespace `id` from the terminal output, then bind it via the Cloudflare Dashboard (**Workers > your worker > Settings > Variables > KV Namespace Bindings**). Do **not** add the namespace ID to `wrangler.toml` — doing so would commit your account-specific ID to version control and prevent the repo from being portable.
4. Set secrets one-by-one:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put AUTHORIZED_USER_IDS
   npx wrangler secret put MONITORING_SECRET
   npx wrangler secret put SERVERS_CONFIG
   ```
5. Build and deploy:
   ```bash
   npm run deploy
   ```

---

## 4. Operational Verification

1. **Health Route**: Query `https://<YOUR-WORKER-SUBDOMAIN>.workers.dev/health` -> should return status `"ok"`.
2. **Dashboard**: Navigate to `https://<YOUR-WORKER-SUBDOMAIN>.workers.dev/` -> should render the status page showing registered nodes.
3. **Telemetry Ingestion**: Send a metrics report. If you did not bind `MONITORING_KV` in the dashboard, the route will return a clear `500 Configuration Error` explaining that the KV binding is missing.
4. **Command Check**: Send `/status` in the Telegram chat to verify command routing and whitelisting.

---

## 5. Rollback Steps

### Method A: Cloudflare Dashboard (Recommended)
1. Go to **Workers & Pages** > select your worker > **Deployments**.
2. Locate the previous stable deployment in the history table.
3. Click the three dots next to that deployment and select **Rollback to this deployment**.

### Method B: Wrangler CLI (Advanced)
1. List deployment history:
   ```bash
   npx wrangler deployments list
   ```
2. Roll back to a specific ID:
   ```bash
   npx wrangler rollback <DEPLOYMENT_ID>
   ```
