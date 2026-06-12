# Disaster Recovery & Troubleshooting

This document outlines mitigation strategies for Control Plane failures, webhook outages, and credential compromises.

## Credential Rotation

If API tokens or secrets are compromised, rotate them immediately using the following procedures.

### 1. Telegram Bot Token
1. Open a chat with `@BotFather` on Telegram.
2. Send `/revoke` and select your bot to revoke the compromised token.
3. Copy the newly generated token.
4. Update Cloudflare Secrets:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```
5. Re-register the webhook using the new token:
   ```bash
   curl -F "url=https://<your-worker>.workers.dev/webhook" https://api.telegram.org/bot<NEW_TOKEN>/setWebhook
   ```

### 2. AWS Credentials
1. Log into AWS IAM Console, find the bot user account, and delete the compromised Access Key.
2. Generate a new Access Key ID and Secret Access Key.
3. Update Cloudflare Secrets:
   ```bash
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   ```

### 3. DigitalOcean Tokens
1. Log into DigitalOcean Console, navigate to API, and revoke the compromised token.
2. Create a new Read/Write token.
3. Update Cloudflare Secrets:
   ```bash
   npx wrangler secret put DIGITALOCEAN_TOKEN
   ```

---

## Webhook Troubleshooting Flowchart

If the Telegram bot does not respond:

```
[Is the Bot receiving messages?]
   │
   ├── No ──> Check Webhook Info:
   │          curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   │          Verify:
   │            - "url" points to the correct Cloudflare Worker.
   │            - "last_error_message" is empty.
   │            - "pending_update_count" is low.
   │
   └── Yes ──> Inspect Cloudflare Logs:
               npx wrangler tail
               Verify:
                 - HTTP status code (should be 200 OK).
                 - Look for "AuthMiddleware: Rejected request" (authorized ID mismatch).
                 - Look for "Configuration Error: TELEGRAM_BOT_TOKEN is not defined" (missing secrets).
```

### 1. Webhook SSL Issues
Cloudflare Workers automatically provide valid, trusted HTTPS SSL certificates. However, if using a custom domain, ensure Cloudflare SSL/TLS configuration is set to **Full** or **Full (Strict)**. Telegram Bot API rejects self-signed or invalid SSL certificates.

### 2. Clearing Pending Webhook Updates
If the bot was down for a long period, Telegram queues updates. When the bot restarts, it might hit rate limits or timeout processing old messages.
Clear the queue by temporarily deleting the webhook:
```bash
curl https://api.telegram.org/bot<TOKEN>/deleteWebhook?drop_pending_updates=true
```
Then re-register the webhook.
