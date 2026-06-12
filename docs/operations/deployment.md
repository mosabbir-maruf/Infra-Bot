# Operations and Deployment Guide

This guide details the standard, dashboard-centric workflow for deploying the Mosabbir Infrastructure Bot to Cloudflare using Git integration, followed by local development and manual Wrangler CLI instructions for advanced use cases.

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
Upon your first deployment, Cloudflare automatically provisions all required and optional configuration keys in the dashboard using the default placeholder values defined in `wrangler.toml`. You do not need to create these variable keys manually.

To set your actual configurations:
1. In the Cloudflare Dashboard, select your worker > **Settings** > **Variables**.
2. Under **Variables & Secrets**, you will see the pre-populated keys.
3. Click **Edit** (or **Edit variables**).
4. Replace the default placeholder values with your actual credentials.
5. For sensitive items (such as `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_USER_IDS`, `MONITORING_SECRET`, `AWS_SECRET_ACCESS_KEY`, and `DIGITALOCEAN_TOKEN`), click the **Encrypt** button next to the variable name to convert them into secure write-only Secrets.
6. Click **Save and Deploy**.

> [!IMPORTANT]
> **Security Requirement**: When configuring these variables in the Cloudflare Dashboard, you **must** click the **Encrypt** button next to each sensitive credential (such as bot tokens, API keys, and provider secrets). This permanently converts them into secure, write-only **Secrets**, preventing them from being exposed in plain text in your dashboard.

#### Environment Configuration Table:

| Key | Type | Required? | Description |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Secret | **Yes** | Your Telegram Bot token from `@BotFather`. |
| `AUTHORIZED_USER_IDS` | Secret | **Yes** | Comma-separated list of whitelisted Telegram User IDs. |
| `SERVERS_CONFIG` | Secret | **Yes** | JSON configuration string mapping server aliases to instances. |
| `MONITORING_SECRET` | Secret | **Yes** | Shared HMAC secret key used to verify telemetry reports. |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | No (Rec.) | Arbitrary secret header token to verify incoming webhook requests. |
| `AWS_ACCESS_KEY_ID` | Secret | No (Opt.) | AWS IAM User Access Key for EC2 integration. |
| `AWS_SECRET_ACCESS_KEY` | Secret | No (Opt.) | AWS IAM User Secret Key for EC2 integration. |
| `DIGITALOCEAN_TOKEN` | Secret | No (Opt.) | Personal Access Token for DigitalOcean integration. |

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

### Step 6: Configure GitHub Actions Secrets (for CI/CD)
To enable automated deployments from GitHub:
1. In your GitHub repository, navigate to **Settings** > **Secrets and Variables** > **Actions**.
2. Click **New repository secret**.
3. Name the secret `CLOUDFLARE_API_TOKEN`.
4. Set its value to your Cloudflare API token. You can create this token in your Cloudflare dashboard under **My Profile** > **API Tokens** > **Create Token** > using the **Edit Cloudflare Workers** template.
5. Once saved, any push to the `main` branch will automatically build, test, and deploy the worker to your Cloudflare account.

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
3. Copy the namespace `id` from the terminal output and add it manually to your [wrangler.toml](file:///Volumes/Mosabbir/Developement/Project/mosabbir-infra-bot/wrangler.toml) configuration:
   ```toml
   [[kv_namespaces]]
   binding = "MONITORING_KV"
   id = "YOUR_COPIED_KV_NAMESPACE_ID"
   ```
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
