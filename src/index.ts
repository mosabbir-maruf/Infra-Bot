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

// Root endpoint serving a premium HTML status dashboard
app.get('/', (c) => {
  let serversHtml = '';
  let serverCount = 0;
  let awsCount = 0;
  let doCount = 0;

  try {
    const ctxCache = getContext(c.env);
    const servers = ctxCache.serverRegistry.getAllServers();
    serverCount = servers.length;

    if (servers.length === 0) {
      serversHtml = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div class="empty-title">No Nodes Registered</div>
          <div class="empty-desc">Configure servers in your SERVERS_CONFIG environment variable.</div>
        </div>`;
    } else {
      servers.forEach((srv) => {
        const isAws = srv.provider.toUpperCase() === 'AWS';
        if (isAws) awsCount++; else doCount++;

        const providerIcon = isAws
          ? `<svg class="provider-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.072.056.144.056.208 0 .09-.056.18-.176.27l-.583.39a.444.444 0 01-.24.08c-.096 0-.192-.048-.288-.136a2.965 2.965 0 01-.344-.45 7.365 7.365 0 01-.296-.569c-.744.877-1.68 1.315-2.808 1.315-.803 0-1.443-.23-1.912-.687-.47-.457-.704-1.067-.704-1.829 0-.81.284-1.462.856-1.95.572-.487 1.332-.731 2.296-.731.32 0 .648.028.992.076.344.048.696.12 1.064.2v-.677c0-.706-.148-1.2-.436-1.49-.296-.29-.797-.432-1.51-.432-.324 0-.656.04-.996.12a7.36 7.36 0 00-.996.32 2.64 2.64 0 01-.324.12.566.566 0 01-.144.024c-.128 0-.192-.096-.192-.296v-.468c0-.152.02-.268.068-.332a.71.71 0 01.276-.2c.324-.168.712-.308 1.164-.42.452-.12.932-.176 1.44-.176 1.096 0 1.896.248 2.408.744.504.496.76 1.252.76 2.268v2.988zm-3.878 1.456c.308 0 .624-.056.956-.168.332-.112.628-.316.876-.596.148-.176.26-.372.316-.592.056-.22.088-.488.088-.8v-.384a7.62 7.62 0 00-.86-.156 6.988 6.988 0 00-.876-.056c-.624 0-1.084.12-1.392.368-.308.248-.456.596-.456 1.052 0 .428.108.748.332.964.216.224.524.368.916.368zm7.5.988c-.168 0-.28-.028-.352-.092-.072-.056-.136-.184-.192-.36l-2.14-7.044c-.056-.184-.084-.308-.084-.372 0-.148.072-.232.22-.232h.896c.176 0 .296.028.36.092.072.056.128.184.184.36l1.532 6.032 1.42-6.032c.048-.184.104-.304.176-.36.072-.056.2-.092.368-.092h.732c.176 0 .296.028.376.092.072.056.136.184.176.36l1.44 6.108 1.58-6.108c.056-.184.12-.304.184-.36.072-.056.184-.092.352-.092h.852c.148 0 .228.076.228.232 0 .044-.008.092-.02.148a1.48 1.48 0 01-.072.232l-2.196 7.044c-.056.184-.12.304-.192.36-.072.056-.192.092-.352.092h-.788c-.176 0-.296-.028-.376-.092-.072-.064-.136-.184-.176-.368l-1.412-5.876-1.404 5.868c-.048.184-.104.304-.176.368-.072.064-.2.092-.376.092h-.788zm11.716.256c-.472 0-.944-.056-1.4-.164-.456-.108-.812-.228-1.052-.364-.144-.08-.244-.168-.28-.248a.625.625 0 01-.052-.248v-.488c0-.2.076-.296.22-.296a.544.544 0 01.172.032c.056.02.14.056.232.092.316.14.66.252 1.02.328.368.076.728.112 1.096.112.584 0 1.04-.1 1.36-.3.32-.2.488-.492.488-.868 0-.256-.08-.468-.24-.644-.16-.176-.464-.332-.9-.48l-1.292-.4c-.652-.204-1.136-.508-1.436-.908a2.148 2.148 0 01-.452-1.308c0-.376.08-.708.24-1 .16-.29.376-.54.648-.748.272-.208.58-.364.936-.468.356-.104.732-.156 1.128-.156.196 0 .4.012.596.036.204.024.388.056.564.096.168.032.328.076.48.124.152.048.272.096.36.144.12.064.208.132.26.208.052.068.08.16.08.268v.452c0 .2-.076.304-.22.304a1 1 0 01-.364-.116 4.39 4.39 0 00-1.816-.372c-.532 0-.948.088-1.24.272-.292.184-.44.46-.44.836 0 .256.088.472.264.648.176.176.504.352.976.504l1.268.4c.644.204 1.112.492 1.396.86.284.368.424.788.424 1.252 0 .384-.076.732-.228 1.036a2.44 2.44 0 01-.64.792c-.272.216-.596.384-.968.5-.384.124-.8.184-1.248.184z"/></svg>`
          : `<svg class="provider-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3c4.97 0 9 4.03 9 9s-4.03 9-9 9-9-4.03-9-9 4.03-9 9-9zm-1.5 4.5v9l6.75-4.5-6.75-4.5z"/></svg>`;

        const badgeClass = isAws ? 'badge-aws' : 'badge-do';
        const badgeText = isAws ? 'AWS EC2' : 'DigitalOcean';
        const consoleHref = isAws && srv.region
          ? `https://${srv.region}.console.aws.amazon.com/ec2/home?region=${srv.region}#Instances:instanceId=${srv.id}`
          : '#';
        const regionHref = isAws && srv.region
          ? `https://${srv.region}.console.aws.amazon.com/ec2/home?region=${srv.region}#Instances:`
          : '#';

        serversHtml += `
          <div class="server-card">
            <div class="server-header">
              <div class="server-name-row">
                <div class="server-icon ${badgeClass}-icon">${providerIcon}</div>
                <div>
                  <div class="server-alias">${srv.alias}</div>
                  <div class="server-provider-name">${badgeText}</div>
                </div>
              </div>
              <div class="server-status-pill">
                <span class="status-dot"></span>
                <span>Active</span>
              </div>
            </div>
            <div class="card-divider"></div>
            <div class="server-details">
              <div class="detail-row">
                <span class="detail-label">Instance ID</span>
                <span class="detail-value font-mono">
                  ${srv.region
                    ? `<a href="${consoleHref}" target="_blank" rel="noopener noreferrer" class="detail-link">${srv.id}</a>`
                    : `<span>${srv.id}</span>`}
                  <button class="copy-btn" onclick="copyText('${srv.id}', this)" title="Copy Instance ID">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  </button>
                </span>
              </div>
              ${srv.region ? `
              <div class="detail-row">
                <span class="detail-label">Region</span>
                <span class="detail-value font-mono">
                  <a href="${regionHref}" target="_blank" rel="noopener noreferrer" class="detail-link">${srv.region}</a>
                </span>
              </div>` : ''}
              <div class="detail-row">
                <span class="detail-label">Provider</span>
                <span class="detail-value">${badgeText}</span>
              </div>
            </div>
          </div>
        `;
      });
    }
  } catch (err) {
    serversHtml = `
      <div class="error-card">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Failed to load server registry: ${(err as Error).message}</span>
      </div>`;
  }

  const now = new Date();
  const buildTime = now.toISOString();
  const year = now.getFullYear();

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Mosabbir Infrastructure Bot - Real-time infrastructure control plane and VM orchestration dashboard powered by Cloudflare Workers.">
  <title>Infra Bot | Control Plane Dashboard</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:          #060608;
      --bg-card:     #0d0d10;
      --bg-card-2:   #111116;
      --border:      rgba(255,255,255,0.07);
      --border-strong: rgba(255,255,255,0.12);
      --fg:          #f0f0f5;
      --fg-muted:    #6b6b80;
      --fg-subtle:   #3a3a4a;
      --green:       #22d45e;
      --green-dim:   rgba(34,212,94,0.12);
      --green-glow:  rgba(34,212,94,0.25);
      --aws:         #ff9932;
      --aws-dim:     rgba(255,153,50,0.12);
      --do:          #4d9eff;
      --do-dim:      rgba(77,158,255,0.12);
      --purple:      #a78bfa;
      --purple-dim:  rgba(167,139,250,0.12);
      --red:         #f87171;
      --red-dim:     rgba(248,113,113,0.08);
      --radius:      10px;
      --radius-lg:   14px;
      --font-mono:   'JetBrains Mono', 'Fira Code', monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { scroll-behavior: smooth; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(167,139,250,0.08) 0%, transparent 60%),
        radial-gradient(ellipse 60% 40% at 80% 90%, rgba(34,212,94,0.05) 0%, transparent 50%);
      background-attachment: fixed;
      color: var(--fg);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* ---- Layout ---- */
    .page {
      max-width: 680px;
      margin: 0 auto;
      padding: 3rem 1.5rem 5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    /* ---- Header ---- */
    .header {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--purple), #7c3aed);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 0 20px rgba(167,139,250,0.3);
    }

    .brand-icon svg { color: #fff; }

    .brand-text h1 {
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      color: var(--fg);
      line-height: 1.2;
    }

    .brand-text .tagline {
      font-size: 0.75rem;
      color: var(--fg-muted);
      font-weight: 400;
    }

    .live-clock {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--fg-muted);
      background: var(--bg-card);
      border: 1px solid var(--border);
      padding: 0.3rem 0.7rem;
      border-radius: 6px;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }

    /* ---- Operational Banner ---- */
    .op-banner {
      background: var(--green-dim);
      border: 1px solid rgba(34,212,94,0.2);
      border-radius: var(--radius);
      padding: 0.875rem 1.125rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .op-left {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .pulse-wrap {
      position: relative;
      width: 10px;
      height: 10px;
      flex-shrink: 0;
    }

    .pulse-core {
      position: absolute;
      inset: 0;
      background: var(--green);
      border-radius: 50%;
    }

    .pulse-ring {
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 1.5px solid var(--green);
      animation: ping 2s cubic-bezier(0,0,0.2,1) infinite;
      opacity: 0;
    }

    @keyframes ping {
      0%   { transform: scale(0.8); opacity: 0.8; }
      80%, 100% { transform: scale(2); opacity: 0; }
    }

    .op-label {
      font-size: 0.825rem;
      font-weight: 500;
      color: var(--green);
    }

    .op-desc {
      font-size: 0.72rem;
      color: var(--fg-muted);
    }

    .op-ts {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--fg-muted);
      background: rgba(255,255,255,0.04);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      white-space: nowrap;
    }

    /* ---- Stat Bar ---- */
    .stat-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.875rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      transition: border-color 0.2s;
    }

    .stat-card:hover { border-color: var(--border-strong); }

    .stat-label {
      font-size: 0.68rem;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .stat-value.green { color: var(--green); }
    .stat-value.aws   { color: var(--aws); }
    .stat-value.do    { color: var(--do); }

    .stat-sub {
      font-size: 0.68rem;
      color: var(--fg-muted);
    }

    /* ---- Section Header ---- */
    .section-hdr {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.875rem;
    }

    .section-hdr-label {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .section-hdr-line {
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .section-hdr-count {
      font-size: 0.65rem;
      font-family: var(--font-mono);
      color: var(--fg-subtle);
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
    }

    /* ---- Server Cards ---- */
    .server-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .server-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.125rem 1.25rem;
      transition: border-color 0.2s, box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    }

    .server-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
    }

    .server-card:hover {
      border-color: var(--border-strong);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.4);
    }

    .server-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .server-name-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .server-icon {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .badge-aws-icon { background: var(--aws-dim); color: var(--aws); }
    .badge-do-icon  { background: var(--do-dim);  color: var(--do); }

    .provider-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .server-alias {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--fg);
      letter-spacing: -0.01em;
    }

    .server-provider-name {
      font-size: 0.7rem;
      color: var(--fg-muted);
      margin-top: 0.05rem;
    }

    .server-status-pill {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: var(--green-dim);
      border: 1px solid rgba(34,212,94,0.15);
      border-radius: 9999px;
      padding: 0.2rem 0.6rem;
      font-size: 0.68rem;
      font-weight: 500;
      color: var(--green);
    }

    .status-dot {
      width: 5px;
      height: 5px;
      background: var(--green);
      border-radius: 50%;
      flex-shrink: 0;
    }

    .card-divider {
      height: 1px;
      background: var(--border);
      margin-bottom: 0.875rem;
    }

    .server-details {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
      gap: 1rem;
    }

    .detail-label {
      color: var(--fg-muted);
      font-weight: 400;
      flex-shrink: 0;
    }

    .detail-value {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 0;
      color: var(--fg);
    }

    .font-mono {
      font-family: var(--font-mono);
      font-size: 0.73rem;
    }

    .detail-link {
      color: var(--purple);
      text-decoration: none;
      transition: color 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
      display: inline-block;
    }

    .detail-link:hover { color: #c4b5fd; text-decoration: underline; }

    /* ---- Copy Button ---- */
    .copy-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--fg-muted);
      cursor: pointer;
      padding: 2px 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
      flex-shrink: 0;
    }

    .copy-btn:hover {
      color: var(--fg);
      border-color: var(--border-strong);
      background: rgba(255,255,255,0.05);
    }

    .copy-btn.copied {
      color: var(--green);
      border-color: rgba(34,212,94,0.3);
    }

    /* ---- Empty State ---- */
    .empty-state {
      text-align: center;
      padding: 3rem 2rem;
      border: 1px dashed rgba(255,255,255,0.08);
      border-radius: var(--radius-lg);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .empty-icon { color: var(--fg-muted); margin-bottom: 0.25rem; }
    .empty-title { font-size: 0.875rem; font-weight: 500; color: var(--fg-muted); }
    .empty-desc  { font-size: 0.75rem; color: var(--fg-subtle); max-width: 280px; }

    /* ---- Error Card ---- */
    .error-card {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      color: var(--red);
      background: var(--red-dim);
      border: 1px solid rgba(248,113,113,0.15);
      padding: 0.875rem 1rem;
      border-radius: var(--radius);
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .error-card svg { flex-shrink: 0; margin-top: 1px; }

    /* ---- Info Bar ---- */
    .info-bar {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.875rem 1.125rem;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem 1.5rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .info-label {
      font-size: 0.65rem;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
    }

    .info-value {
      font-size: 0.78rem;
      color: var(--fg);
      font-family: var(--font-mono);
    }

    /* ---- Footer ---- */
    footer {
      border-top: 1px solid var(--border);
      padding-top: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .footer-brand {
      font-size: 0.72rem;
      color: var(--fg-muted);
    }

    .footer-links {
      display: flex;
      gap: 1rem;
    }

    .footer-link {
      font-size: 0.72rem;
      color: var(--fg-muted);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      transition: color 0.15s;
    }

    .footer-link:hover { color: var(--fg); }

    /* ---- Scrollbar ---- */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <div class="brand">
          <div class="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 20V10M12 20V4M6 20v-6"/>
            </svg>
          </div>
          <div class="brand-text">
            <h1>Infrastructure Control Plane</h1>
            <div class="tagline">Telegram-native VM orchestration &amp; telemetry</div>
          </div>
        </div>
        <div class="live-clock" id="live-clock">--:--:-- UTC</div>
      </div>
    </header>

    <!-- Operational Banner -->
    <div class="op-banner">
      <div class="op-left">
        <div class="pulse-wrap">
          <div class="pulse-core"></div>
          <div class="pulse-ring"></div>
        </div>
        <div>
          <div class="op-label">All Systems Operational</div>
          <div class="op-desc">Cloudflare Worker edge runtime active &mdash; serving globally</div>
        </div>
      </div>
      <div class="op-ts" id="rendered-at">${buildTime}</div>
    </div>

    <!-- Stat Bar -->
    <div class="stat-bar">
      <div class="stat-card">
        <div class="stat-label">Registered Nodes</div>
        <div class="stat-value green">${serverCount}</div>
        <div class="stat-sub">Total servers</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">AWS EC2</div>
        <div class="stat-value aws">${awsCount}</div>
        <div class="stat-sub">Instances</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">DigitalOcean</div>
        <div class="stat-value do">${doCount}</div>
        <div class="stat-sub">Droplets</div>
      </div>
    </div>

    <!-- Server Nodes -->
    <section>
      <div class="section-hdr">
        <span class="section-hdr-label">Registered Nodes</span>
        <div class="section-hdr-line"></div>
        <span class="section-hdr-count">${serverCount}</span>
      </div>
      <div class="server-list">
        ${serversHtml}
      </div>
    </section>

    <!-- Info Bar -->
    <div class="info-bar">
      <div class="info-item">
        <span class="info-label">Edge Runtime</span>
        <span class="info-value">Cloudflare Workers</span>
      </div>
      <div class="info-item">
        <span class="info-label">Bot Interface</span>
        <span class="info-value">Telegram Bot API</span>
      </div>
      <div class="info-item">
        <span class="info-label">Webhook</span>
        <span class="info-value">/webhook</span>
      </div>
      <div class="info-item">
        <span class="info-label">Health Check</span>
        <span class="info-value">/health</span>
      </div>
    </div>

    <!-- Footer -->
    <footer>
      <span class="footer-brand">&copy; ${year} Mosabbir Infrastructure Bot</span>
      <div class="footer-links">
        <a href="/health" class="footer-link">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Health
        </a>
        <a href="https://workers.cloudflare.com" target="_blank" rel="noopener" class="footer-link">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          CF Workers
        </a>
      </div>
    </footer>

  </div>

  <script>
    // Live UTC clock
    function updateClock() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      document.getElementById('live-clock').textContent =
        pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds()) + ' UTC';
    }
    updateClock();
    setInterval(updateClock, 1000);

    // Human-readable rendered-at timestamp
    const ts = document.getElementById('rendered-at');
    if (ts) {
      try {
        const d = new Date(ts.textContent.trim());
        ts.textContent = d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
      } catch(_) {}
    }

    // Copy to clipboard
    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 1800);
      });
    }
  </script>
</body>
</html>`;

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
