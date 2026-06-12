import { Hono } from 'hono';
import { validateEnv, Env } from './config/Env';
import { isAuthorized } from './telegram/middleware/AuthMiddleware';
import { CommandRouter } from './telegram/CommandRouter';
import { Logger } from './utils/Logger';
import { CloudflareKVRateLimiter } from './middleware/RateLimiter';
import { TelegramClient } from './telegram/TelegramClient';
import { TelegramUpdate } from './types';
import { verifyHmacSignature } from './utils/Crypto';
import { ServerRegistry } from './config/ServerRegistry';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { faviconBase64, favicon32Base64, favicon16Base64 } from './assets/favicon';

// Strict type bindings for Hono environment
interface Bindings {
  TELEGRAM_BOT_TOKEN: string;
  AUTHORIZED_USER_IDS: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  DIGITALOCEAN_TOKEN?: string;
  NODE_ENV?: string;
  SERVERS_CONFIG: string;
  MONITORING_SECRET: string;
  MONITORING_KV: KVNamespace;
  RATE_LIMIT_KV?: KVNamespace;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

export const app = new Hono<{ Bindings: Bindings }>();
const router = new CommandRouter();

// Isolate-level memory cache for context parameters
let cachedEnv: Env | null = null;
let cachedServerRegistry: ServerRegistry | null = null;
let cachedProviderRegistry: ProviderRegistry | null = null;
let cachedRateLimiter: CloudflareKVRateLimiter | null = null;

/**
 * Resolves context config and registries.
 * Executes validation and JSON parsing exactly once during isolate lifetime.
 */
function getContext(rawEnv: unknown): {
  env: Env;
  serverRegistry: ServerRegistry;
  providerRegistry: ProviderRegistry;
  rateLimiter: CloudflareKVRateLimiter;
} {
  const envObj = (rawEnv && typeof rawEnv === 'object') ? (rawEnv as Record<string, unknown>) : {};
  const isTest = envObj.NODE_ENV === 'test';

  if (!isTest && cachedEnv && cachedServerRegistry && cachedProviderRegistry && cachedRateLimiter) {
    return {
      env: cachedEnv,
      serverRegistry: cachedServerRegistry,
      providerRegistry: cachedProviderRegistry,
      rateLimiter: cachedRateLimiter,
    };
  }

  const env = validateEnv(rawEnv);
  const rateLimitKv = envObj.RATE_LIMIT_KV;

  if (isTest) {
    return {
      env,
      serverRegistry: new ServerRegistry(env.SERVERS_CONFIG),
      providerRegistry: new ProviderRegistry(env),
      rateLimiter: new CloudflareKVRateLimiter(rateLimitKv),
    };
  }

  const serverRegistry = new ServerRegistry(env.SERVERS_CONFIG);
  const providerRegistry = new ProviderRegistry(env);
  const rateLimiter = new CloudflareKVRateLimiter(rateLimitKv);

  cachedEnv = env;
  cachedServerRegistry = serverRegistry;
  cachedProviderRegistry = providerRegistry;
  cachedRateLimiter = rateLimiter;

  return { env, serverRegistry, providerRegistry, rateLimiter };
}

// Centralized error fallback for the HTTP router
app.onError((err, c) => {
  Logger.error('HTTP router caught unhandled error', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Control Plane health endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint serving a premium HTML status dashboard (shadcn/ui minimal zinc aesthetic)
app.get('/', (c) => {
  let serversHtml = '';
  try {
    const ctxCache = getContext(c.env);
    const servers = ctxCache.serverRegistry.getAllServers();
    if (servers.length === 0) {
      serversHtml = '<p class="no-servers">No servers registered in configuration registry.</p>';
    } else {
      servers.forEach((srv) => {
        const providerBadge = srv.provider.toUpperCase() === 'AWS'
          ? '<span class="badge badge-aws">AWS</span>'
          : '<span class="badge badge-do">DigitalOcean</span>';

        serversHtml += `
          <div class="server-card">
            <div class="server-header">
              <span class="server-alias">${srv.alias}</span>
              ${providerBadge}
            </div>
            <div class="server-details">
              <div class="detail-row">
                <span class="detail-label">Instance ID:</span>
                <span class="detail-value font-mono">${srv.id}</span>
              </div>
              ${srv.region ? `
              <div class="detail-row">
                <span class="detail-label">Region:</span>
                <span class="detail-value font-mono">${srv.region}</span>
              </div>` : ''}
            </div>
          </div>
        `;
      });
    }
  } catch (err) {
    serversHtml = `<p class="error-msg">Failed to load server registry: ${(err as Error).message}</p>`;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mosabbir Infrastructure Bot | Status Dashboard</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: #09090b;
      --foreground: #fafafa;
      --muted: #71717a;
      --muted-bg: #18181b;
      --border: #27272a;
      --accent-green: #22c55e;
      --accent-green-bg: rgba(34, 197, 94, 0.1);
      --accent-aws: #f97316;
      --accent-do: #3b82f6;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--background);
      color: var(--foreground);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 4rem 2rem;
      max-width: 600px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 2.5rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 0.25rem;
    }

    .subtitle {
      font-size: 0.875rem;
      color: var(--muted);
    }

    .status-banner {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      background-color: var(--background);
    }

    .status-left {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .status-title {
      font-size: 0.875rem;
      font-weight: 500;
    }

    .status-desc {
      font-size: 0.75rem;
      color: var(--muted);
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--accent-green-bg);
      border: 1px solid rgba(34, 197, 94, 0.2);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      background-color: var(--accent-green);
      border-radius: 50%;
    }

    .status-text {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent-green);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }

    .server-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .server-card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      background-color: var(--background);
    }

    .server-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .server-alias {
      font-weight: 500;
      font-size: 0.95rem;
    }

    .badge {
      font-size: 0.7rem;
      font-weight: 500;
      padding: 0.125rem 0.375rem;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .badge-aws {
      background: rgba(249, 115, 22, 0.1);
      border: 1px solid rgba(249, 115, 22, 0.2);
      color: var(--accent-aws);
    }

    .badge-do {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.2);
      color: var(--accent-do);
    }

    .server-details {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
    }

    .detail-label {
      color: var(--muted);
    }

    .detail-value {
      font-weight: 400;
    }

    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }

    .no-servers {
      text-align: center;
      padding: 2rem;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 6px;
      font-size: 0.875rem;
    }

    .error-msg {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.05);
      border: 1px solid rgba(239, 68, 68, 0.1);
      padding: 0.75rem;
      border-radius: 4px;
      font-size: 0.825rem;
    }

    footer {
      margin-top: auto;
      padding-top: 4rem;
      font-size: 0.75rem;
      color: var(--muted);
      text-align: left;
    }
  </style>
</head>
<body>

  <header>
    <h1>Infrastructure Control Plane</h1>
    <div class="subtitle">Secure server telemetry and VM orchestration via Telegram</div>
  </header>

  <main>
    <div class="status-banner">
      <div class="status-left">
        <div class="status-title">Control Edge Status</div>
        <div class="status-desc">Cloudflare Worker serving APIs globally</div>
      </div>
      <div class="status-indicator">
        <div class="pulse-dot"></div>
        <div class="status-text">Operational</div>
      </div>
    </div>

    <div class="section-title">Registered Nodes</div>
    <div class="server-list">
      ${serversHtml}
    </div>
  </main>

  <footer>
    &copy; ${new Date().getFullYear()} Mosabbir Infrastructure Control Plane. All rights reserved.
  </footer>

</body>
</html>
  `;

  return c.html(htmlContent, 200);
});

// Favicon endpoints serving actual image data
app.get('/favicon.ico', (c) => {
  const bytes = Uint8Array.from(atob(faviconBase64), (ch) => ch.charCodeAt(0));
  return c.body(bytes.buffer, 200, {
    'Content-Type': 'image/x-icon',
    'Cache-Control': 'public, max-age=86400',
  });
});

app.get('/favicon-32x32.png', (c) => {
  const bytes = Uint8Array.from(atob(favicon32Base64), (ch) => ch.charCodeAt(0));
  return c.body(bytes.buffer, 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  });
});

app.get('/favicon-16x16.png', (c) => {
  const bytes = Uint8Array.from(atob(favicon16Base64), (ch) => ch.charCodeAt(0));
  return c.body(bytes.buffer, 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400',
  });
});

// Telegram Webhook Handler
app.post('/webhook', async (c) => {
  let ctxCache;
  try {
    ctxCache = getContext(c.env);
  } catch (configErr) {
    Logger.error('Configuration binding validation failed', configErr);
    return c.text('Internal Server Error: Missing Config', 500);
  }
  const { env, serverRegistry, providerRegistry, rateLimiter } = ctxCache;

  // 0. Webhook source verification (Telegram API Secret Token)
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const receivedSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      Logger.warn('Webhook: Forbidden webhook request - secret token mismatch or missing');
      return c.text('Forbidden: Webhook Secret Mismatch', 403);
    }
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch (jsonErr) {
    Logger.error('Failed to parse webhook JSON payload', jsonErr);
    return c.text('Bad Request', 400);
  }

  // 1. Authorization checks
  if (!isAuthorized(update, env)) {
    return c.text('Access Denied', 200);
  }

  const message = update.message;
  if (!message || !message.text) {
    return c.text('Ignored non-text payload', 200);
  }

  const userId = message.from!.id;

  // 2. Distributed Rate Limiting (10 requests / 60 seconds)
  const rateLimitKey = `rl:${userId}`;
  const isLimited = await rateLimiter.isRateLimited(rateLimitKey, 10, 60);

  if (isLimited) {
    Logger.warn(`Rate limiter activated for user ID ${userId}`, { userId });
    try {
      const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
      await client.sendMessage(
        message.chat.id,
        '⚠️ <b>Rate Limit Exceeded</b>\nLimit is 10 commands per minute. Please cool down.',
        'HTML',
      );
    } catch (err) {
      Logger.error('Failed to notify rate limit to user', err);
    }
    return c.text('Rate Limit Active', 200);
  }

  // 3. Process the command asynchronously
  const routePromise = router.route(message, env, serverRegistry, providerRegistry).catch((err) => {
    Logger.error('Background command execution failed', err, {
      userId,
      command: message.text,
    });
  });

  try {
    c.executionCtx.waitUntil(routePromise);
  } catch {
    // Fallback for testing environments where c.executionCtx is not bound
  }

  return c.text('Accepted', 200);
});

// Authenticated Monitoring Report Ingestion Endpoint
app.post('/monitoring/report', async (c) => {
  let ctxCache;
  try {
    ctxCache = getContext(c.env);
  } catch (configErr) {
    Logger.error('Monitoring report: Environment validation failed', configErr);
    return c.text('Configuration Error', 500);
  }
  const { env, serverRegistry } = ctxCache;

  const kv = c.env.MONITORING_KV;
  if (!kv) {
    Logger.error('Monitoring report: MONITORING_KV namespace is not bound. Configure it in your Cloudflare dashboard.');
    return c.text('Configuration Error: MONITORING_KV binding is missing. Please bind it in Cloudflare settings.', 500);
  }

  const signature = c.req.header('X-Signature');
  const alias = c.req.header('X-Server-Alias');

  if (!signature || !alias) {
    Logger.warn('Monitoring report: Missing signature or server alias header');
    return c.text('Missing authentication headers', 400);
  }

  // Check if alias is valid in registry
  const server = serverRegistry.getServer(alias);
  if (!server) {
    Logger.warn(`Monitoring report: Rejected report for unregistered alias "${alias}"`);
    return c.text('Server alias not registered', 403);
  }

  const bodyText = await c.req.text();
  const isValidSignature = await verifyHmacSignature(bodyText, signature, env.MONITORING_SECRET);

  if (!isValidSignature) {
    Logger.warn(`Monitoring report: Rejected report for "${alias}" due to signature mismatch`);
    return c.text('Unauthorized signature', 401);
  }

  interface MonitoringPayload {
    timestamp: number;
    cpu: string;
    ram: { total: number; used: number };
    swap: { total: number; used: number };
    disk: { total: number; used: number };
    uptime: number;
    docker: {
      running: number;
      total: number;
      unhealthy: number;
      containers: Array<{ name: string; status: string; state: string }>;
    };
    bandwidth: { rx: number; tx: number };
  }

  let payload: MonitoringPayload;
  try {
    payload = JSON.parse(bodyText) as MonitoringPayload;
  } catch (jsonErr) {
    Logger.error('Monitoring report: Failed to parse request body JSON', jsonErr);
    return c.text('Invalid JSON format', 400);
  }

  // Prevent replay attacks (check clock drift)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > 300) {
    Logger.warn(`Monitoring report: Rejected report for "${alias}" due to clock drift (>300s)`);
    return c.text('Request timestamp expired (clock drift)', 400);
  }



  // Store metrics in KV
  const key = `metrics:${alias.toLowerCase()}`;
  await kv.put(key, bodyText);
  Logger.info(`Monitoring report: Stored metrics telemetry for "${alias}"`);

  // Bandwidth limit warnings checking
  const totalB = (payload.bandwidth?.rx || 0) + (payload.bandwidth?.tx || 0);
  const totalGB = totalB / (1024 * 1024 * 1024);

  const currentMonth = new Date().toISOString().substring(0, 7); // "YYYY-MM"
  const alertThresholds = [50, 80, 95];

  for (const threshold of alertThresholds) {
    if (totalGB >= threshold) {
      const alertKey = `alert:${alias.toLowerCase()}:${threshold}:${currentMonth}`;
      const isSent = await kv.get(alertKey);

      if (!isSent) {
        // Mark alert as sent
        await kv.put(alertKey, 'true', { expirationTtl: 30 * 24 * 3600 });
        Logger.warn(`Monitoring report: Bandwidth threshold ${threshold} GB crossed for ${alias}`);

        // Dispatch alert messages to operators
        const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
        const warningMessage = `⚠️ <b>Bandwidth Threshold Warning: ${alias.toUpperCase()}</b>\nMonthly bandwidth usage has reached <b>${totalGB.toFixed(2)} GB</b>, crossing the <b>${threshold} GB</b> alert limit.`;

        for (const userId of env.AUTHORIZED_USER_IDS) {
          const alertPromise = client.sendMessage(userId, warningMessage, 'HTML').catch((err) => {
            Logger.error(`Failed to send bandwidth alert to user ${userId}`, err);
          });
          try {
            c.executionCtx.waitUntil(alertPromise);
          } catch {
            // Fallback for testing environments
          }
        }
      }
    }
  }

  return c.text('OK', 200);
});

// Daily scheduled cron report handler
async function handleDailyReport(env: unknown): Promise<void> {
  let ctxCache;
  try {
    ctxCache = getContext(env);
  } catch (err) {
    Logger.error('Daily Report: Failed to validate environment configuration', err);
    return;
  }
  const { env: validatedEnv, serverRegistry } = ctxCache;
  const servers = serverRegistry.getAllServers();

  const kv = (env as Bindings).MONITORING_KV;
  if (!kv) {
    Logger.error('Daily Report: MONITORING_KV namespace is not bound. Skipping report generation.');
    return;
  }

  let report = '📊 <b>Daily Infrastructure Health Summary</b>\n\n';
  let activeCount = 0;

  for (const server of servers) {
    const data = await kv.get(`metrics:${server.alias.toLowerCase()}`);
    if (!data) {
      report += `⚪ <b>${server.alias}</b>: No telemetry received.\n\n`;
      continue;
    }

    try {
      interface MetricsJson {
        timestamp: number;
        cpu: string;
        ram: { total: number; used: number };
        disk: { total: number; used: number };
        uptime: number;
        docker: { running: number; total: number };
        bandwidth: { rx: number; tx: number };
      }

      const metrics = JSON.parse(data) as MetricsJson;
      const lastSeen = new Date(metrics.timestamp * 1000);
      const ageMinutes = (Date.now() - lastSeen.getTime()) / (1000 * 60);

      let statusEmoji = '🟢';
      if (ageMinutes > 15) {
        statusEmoji = '🔴 (Stale telemetry)';
      } else {
        activeCount++;
      }

      const ramUsedGB = (metrics.ram.used / 1024).toFixed(2);
      const ramTotalGB = (metrics.ram.total / 1024).toFixed(2);
      const diskUsedGB = (metrics.disk.used / 1024).toFixed(2);
      const diskTotalGB = (metrics.disk.total / 1024).toFixed(2);

      const totalBandwidthBytes = (metrics.bandwidth?.rx || 0) + (metrics.bandwidth?.tx || 0);
      const totalBandwidthGB = (totalBandwidthBytes / (1024 * 1024 * 1024)).toFixed(2);

      const days = Math.floor(metrics.uptime / (24 * 3600));
      const hours = Math.floor((metrics.uptime % (24 * 3600)) / 3600);
      const uptimeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

      report += `${statusEmoji} <b>${server.alias}</b>
• <b>CPU:</b> <code>${metrics.cpu}%</code> | <b>Uptime:</b> <code>${uptimeStr}</code>
• <b>RAM:</b> <code>${ramUsedGB} GB / ${ramTotalGB} GB</code>
• <b>Disk:</b> <code>${diskUsedGB} GB / ${diskTotalGB} GB</code>
• <b>Docker:</b> <code>${metrics.docker.running}/${metrics.docker.total} running</code>
• <b>Monthly BW:</b> <code>${totalBandwidthGB} GB</code>\n\n`;
    } catch {
      report += `⚠️ <b>${server.alias}</b>: Corrupted telemetry data.\n\n`;
    }
  }

  report += `Summary: ${activeCount} / ${servers.length} servers active.`;

  const client = new TelegramClient(validatedEnv.TELEGRAM_BOT_TOKEN);
  for (const userId of validatedEnv.AUTHORIZED_USER_IDS) {
    try {
      await client.sendMessage(userId, report, 'HTML');
    } catch (sendErr) {
      Logger.error(`Daily Report: Failed to deliver report to user ${userId}`, sendErr);
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled(_event: unknown, env: unknown, ctx: { waitUntil(promise: Promise<void>): void }): void {
    ctx.waitUntil(handleDailyReport(env));
  },
};
