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
        <tr><td colspan="4" class="empty-cell">
          <span class="empty-hint">— no nodes registered in SERVERS_CONFIG —</span>
        </td></tr>`;
    } else {
      servers.forEach((srv, idx) => {
        const isAws = srv.provider.toUpperCase() === 'AWS';
        if (isAws) awsCount++; else doCount++;

        const consoleHref = isAws && srv.region
          ? `https://${srv.region}.console.aws.amazon.com/ec2/home?region=${srv.region}#Instances:instanceId=${srv.id}`
          : null;
        const regionHref = isAws && srv.region
          ? `https://${srv.region}.console.aws.amazon.com/ec2/home?region=${srv.region}#Instances:`
          : null;

        const instanceCell = consoleHref
          ? `<a href="${consoleHref}" target="_blank" rel="noopener noreferrer" class="tbl-link">${srv.id}</a>`
          : `<span>${srv.id}</span>`;

        const regionCell = regionHref
          ? `<a href="${regionHref}" target="_blank" rel="noopener noreferrer" class="tbl-link">${srv.region}</a>`
          : `<span class="dim">—</span>`;

        const providerTag = isAws
          ? `<span class="tag tag-aws">EC2</span>`
          : `<span class="tag tag-do">DO</span>`;

        serversHtml += `
          <tr class="node-row" style="--row-i:${idx}">
            <td class="td-idx mono dim">${String(idx + 1).padStart(2, '0')}</td>
            <td class="td-name">
              <span class="node-name">${srv.alias}</span>
            </td>
            <td class="td-id mono">
              <span class="id-wrap">
                ${instanceCell}
                <button class="copy-btn" onclick="cp('${srv.id}',this)" title="Copy">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
              </span>
            </td>
            <td class="td-region mono">${regionCell}</td>
            <td class="td-provider">${providerTag}</td>
            <td class="td-status"><span class="status-dot"><span class="state-tag">registered</span></span></td>
          </tr>`;
      });
    }
  } catch (err) {
    serversHtml = `
      <tr><td colspan="6" class="error-cell">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${(err as Error).message}
      </td></tr>`;
  }

  const now = new Date();
  const buildTime = now.toISOString();
  const year = now.getFullYear();

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Mosabbir Infra Bot — server orchestration and telemetry control plane.">
  <title>infra-bot · control plane</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:       #0c0b09;
      --surface:  #131210;
      --border:   #252320;
      --border2:  #302e2b;
      --fg:       #e8e4dc;
      --fg2:      #7a7670;
      --fg3:      #3d3b38;
      --amber:    #e8a020;
      --amber-d:  rgba(232,160,32,0.08);
      --amber-b:  rgba(232,160,32,0.18);
      --green:    #3dba6e;
      --green-d:  rgba(61,186,110,0.1);
      --aws-c:    #f59e0b;
      --do-c:     #60a5fa;
      --red:      #e05252;
      --red-d:    rgba(224,82,82,0.08);
      --mono:     'Geist Mono', 'JetBrains Mono', monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { color-scheme: dark; }

    body {
      font-family: 'Geist', 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Top bar ─────────────────────────────── */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      height: 48px;
      gap: 1.5rem;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .wordmark {
      font-family: var(--mono);
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--fg);
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .wordmark-sep {
      color: var(--fg3);
      font-weight: 300;
    }

    .wordmark-sub {
      color: var(--fg2);
      font-weight: 400;
    }

    .topbar-status {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      color: var(--green);
      font-family: var(--mono);
    }

    .dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
      animation: blink 3s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.35; }
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .clock {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--fg2);
      letter-spacing: 0.02em;
    }

    .nav-link {
      font-size: 0.72rem;
      color: var(--fg2);
      text-decoration: none;
      transition: color 0.12s;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .nav-link svg { display: block; }

    .nav-link:hover { color: var(--fg); }

    /* ── Main layout ─────────────────────────── */
    .main {
      max-width: 900px;
      margin: 0 auto;
      padding: 3rem 2rem 6rem;
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }

    /* ── Page header ─────────────────────────── */
    .page-hdr {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 500;
      letter-spacing: -0.03em;
      color: var(--fg);
      line-height: 1.15;
    }

    .page-title span {
      color: var(--amber);
    }

    .page-sub {
      font-size: 0.78rem;
      color: var(--fg2);
      margin-top: 0.3rem;
      font-weight: 400;
    }

    .page-meta {
      text-align: right;
      flex-shrink: 0;
    }

    .meta-line {
      font-family: var(--mono);
      font-size: 0.68rem;
      color: var(--fg3);
      line-height: 1.8;
    }

    .meta-line b {
      color: var(--fg2);
      font-weight: 500;
    }

    /* ── Summary strip ───────────────────────── */
    .summary {
      display: flex;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .summary-item {
      flex: 1;
      padding: 0.875rem 1.25rem;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .summary-item:last-child { border-right: none; }

    .s-label {
      font-size: 0.67rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg3);
      font-weight: 500;
    }

    .s-val {
      font-family: var(--mono);
      font-size: 1.35rem;
      font-weight: 500;
      letter-spacing: -0.02em;
      color: var(--fg);
      line-height: 1;
    }

    .s-val.amber { color: var(--amber); }

    .s-note {
      font-size: 0.67rem;
      color: var(--fg3);
      font-family: var(--mono);
    }

    /* ── Section label ───────────────────────── */
    .section-label {
      font-size: 0.67rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--fg3);
      font-weight: 500;
      margin-bottom: 0.625rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ── Nodes table ─────────────────────────── */
    .tbl-wrap {
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    thead th {
      font-size: 0.67rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg3);
      font-weight: 500;
      padding: 0.55rem 1rem;
      text-align: left;
    }

    thead th:first-child { padding-left: 1.25rem; }
    thead th:last-child  { padding-right: 1.25rem; text-align: center; }

    .node-row {
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
      animation: rowIn 0.25s ease both;
      animation-delay: calc(var(--row-i) * 0.04s);
    }

    @keyframes rowIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .node-row:last-child { border-bottom: none; }
    .node-row:hover { background: rgba(255,255,255,0.02); }

    td {
      padding: 0.75rem 1rem;
      vertical-align: middle;
    }

    td:first-child { padding-left: 1.25rem; }
    td:last-child  { padding-right: 1.25rem; text-align: center; }

    .mono { font-family: var(--mono); font-size: 0.8rem; }
    .dim  { color: var(--fg2); }

    .td-idx { width: 2.5rem; color: var(--fg3); font-size: 0.72rem; }

    .node-name {
      font-family: var(--mono);
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--fg);
      letter-spacing: -0.01em;
    }

    .id-wrap {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
    }

    .tbl-link {
      color: var(--amber);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-color 0.12s;
    }

    .tbl-link:hover { border-bottom-color: var(--amber); }

    /* tags */
    .tag {
      font-family: var(--mono);
      font-size: 0.65rem;
      font-weight: 500;
      padding: 0.15rem 0.45rem;
      border-radius: 3px;
      letter-spacing: 0.04em;
    }

    .tag-aws { background: rgba(245,158,11,0.1); color: var(--aws-c); border: 1px solid rgba(245,158,11,0.2); }
    .tag-do  { background: rgba(96,165,250,0.1);  color: var(--do-c);  border: 1px solid rgba(96,165,250,0.2); }

    /* copy button */
    .copy-btn {
      background: none;
      border: 1px solid var(--border2);
      border-radius: 3px;
      color: var(--fg3);
      cursor: pointer;
      padding: 1px 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.12s, border-color 0.12s;
      vertical-align: middle;
    }

    .copy-btn:hover { color: var(--fg2); border-color: var(--fg3); }
    .copy-btn.ok    { color: var(--green); border-color: rgba(61,186,110,0.3); }

    .status-dot {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .status-dot::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }
    .state-tag {
      font-family: var(--mono);
      font-size: 0.62rem;
      color: var(--fg3);
      letter-spacing: 0.04em;
    }

    /* empty / error */
    .empty-cell, .error-cell {
      padding: 2.5rem 1.25rem;
      text-align: center;
      color: var(--fg3);
      font-family: var(--mono);
      font-size: 0.78rem;
    }

    .error-cell {
      color: var(--red);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    /* ── System info ─────────────────────────── */
    .sys-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .sys-item {
      padding: 0.75rem 1rem;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .sys-item:last-child { border-right: none; }

    .sys-k {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg3);
      font-weight: 500;
    }

    .sys-v {
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--fg2);
    }

    /* ── Commands table ────────────────────────── */
    .cmd-table {
      width: 100%;
      border-collapse: collapse;
    }

    .cmd-row {
      border-bottom: 1px solid var(--border);
    }

    .cmd-row:last-child { border-bottom: none; }
    .cmd-row:hover { background: rgba(255,255,255,0.02); }

    .cmd-cat {
      width: 9rem;
      padding: 0.6rem 1rem 0.6rem 1.25rem;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--fg3);
      font-weight: 500;
      vertical-align: middle;
      white-space: nowrap;
    }

    .cmd-cat-first {
      padding-top: 0.85rem;
    }

    .cmd-name {
      width: 13rem;
      padding: 0.6rem 1rem;
      font-family: var(--mono);
      font-size: 0.78rem;
      color: var(--amber);
      vertical-align: middle;
      white-space: nowrap;
    }

    .cmd-desc {
      padding: 0.6rem 1.25rem 0.6rem 0;
      font-size: 0.78rem;
      color: var(--fg2);
      vertical-align: middle;
      line-height: 1.4;
    }

    .cmd-arg {
      color: var(--fg3);
      font-family: var(--mono);
      font-size: 0.72rem;
    }

    /* ── Footer ──────────────────────────────── */
    .foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }

    .foot-copy {
      font-size: 0.7rem;
      color: var(--fg2);
      font-family: var(--mono);
    }

    .foot-copy a { text-decoration: none; color: inherit; }

    .foot-copy b { color: var(--fg2); font-weight: 500; }

    .foot-links {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .foot-link {
      font-size: 0.7rem;
      color: var(--fg3);
      text-decoration: none;
      font-family: var(--mono);
      transition: color 0.12s;
    }

    .foot-link:hover { color: var(--fg2); }

    /* ── Scrollbar ───────────────────────────── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

    @media (max-width: 640px) {
      .topbar { padding: 0 1rem; }
      .main   { padding: 2rem 1rem 4rem; }
      .page-hdr { flex-direction: column; align-items: flex-start; }
      .page-title { font-size: 1.2rem; }
      .page-meta { text-align: left; }
      .page-meta .meta-line:first-child b { display: block; }
      .topbar-right { gap: 0.75rem; }
      .topbar-status { display: none; }
      .summary { flex-direction: column; }
      .summary-item { border-right: none; border-bottom: 1px solid var(--border); }
      .s-val { font-size: 1.1rem; }
      .sys-grid { grid-template-columns: repeat(2, 1fr); }
      .sys-item:nth-child(2) { border-right: none; }
      .tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .td-region { display: none; }
      .cmd-table th:first-child,
      .cmd-table .cmd-cat { display: none; }
      .cmd-name { width: auto; min-width: 9rem; }
      .cmd-desc { min-width: 8rem; }
      .foot-links { gap: 0.75rem; }
    }
    @media (max-width: 480px) {
      .topbar-right .clock { display: none; }
      .wordmark-sub { display: none; }
      .summary-item { padding: 0.75rem 1rem; }
      td { padding: 0.6rem 0.75rem; }
    }
  </style>
</head>
<body>

  <!-- Top Bar -->
  <div class="topbar">
    <div class="topbar-left">
      <div class="wordmark">
        <span>infra-bot</span>
        <span class="wordmark-sep">/</span>
        <span class="wordmark-sub">control-plane</span>
      </div>
      <div class="topbar-status">
        <span class="dot"></span>
        operational
      </div>
    </div>
    <div class="topbar-right">
      <span class="clock" id="clock">--:--:-- UTC</span>
      <a href="/health" class="nav-link" target="_blank" rel="noopener">health ↗</a>
      <a href="https://workers.cloudflare.com" target="_blank" rel="noopener" class="nav-link">cf workers ↗</a>
      <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener" class="nav-link" aria-label="GitHub repo"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
    </div>
  </div>

  <div class="main">

    <!-- Page Header -->
    <div class="page-hdr">
      <div>
        <h1 class="page-title">Server <span>Registry</span></h1>
        <div class="page-sub">Cloudflare Workers · Telegram Bot API · VM Orchestration</div>
      </div>
      <div class="page-meta">
        <div class="meta-line"><b>rendered</b> <span id="rendered-at">${buildTime}</span></div>
        <div class="meta-line"><b>runtime</b> cloudflare-workers</div>
        <div class="meta-line"><b>uptime</b> <span id="uptime">—</span></div>
      </div>
    </div>

    <!-- Summary Strip -->
    <div class="summary">
      <div class="summary-item">
        <span class="s-label">Total Nodes</span>
        <span class="s-val amber">${serverCount}</span>
        <span class="s-note">registered</span>
      </div>
      <div class="summary-item">
        <span class="s-label">AWS EC2</span>
        <span class="s-val">${awsCount}</span>
        <span class="s-note">instances</span>
      </div>
      <div class="summary-item">
        <span class="s-label">DigitalOcean</span>
        <span class="s-val">${doCount}</span>
        <span class="s-note">droplets</span>
      </div>
    </div>

    <!-- Nodes Table -->
    <section>
      <div class="section-label">nodes</div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Alias</th>
              <th>Instance ID</th>
              <th>Region</th>
              <th>Provider</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            ${serversHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- System Info -->
    <section>
      <div class="section-label">system</div>
      <div class="sys-grid">
        <div class="sys-item">
          <span class="sys-k">Interface</span>
          <span class="sys-v">Telegram Bot API</span>
        </div>
        <div class="sys-item">
          <span class="sys-k">Webhook</span>
          <span class="sys-v">/webhook</span>
        </div>
        <div class="sys-item">
          <span class="sys-k">Cron</span>
          <span class="sys-v">0 8 * * *</span>
        </div>
        <div class="sys-item">
          <span class="sys-k">Health</span>
          <span class="sys-v">/health</span>
        </div>
      </div>
    </section>

    <!-- Commands -->
    <section>
      <div class="section-label">bot commands</div>
      <div class="tbl-wrap">
        <table class="cmd-table">
          <thead>
            <tr>
              <th style="padding-left:1.25rem">Category</th>
              <th>Command</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr class="cmd-row">
              <td class="cmd-cat">Info &amp; Health</td>
              <td class="cmd-name">/status</td>
              <td class="cmd-desc">View live status of all registered servers</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/health</td>
              <td class="cmd-desc">Check Control Plane and provider binding health</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/help</td>
              <td class="cmd-desc">Show available commands and usage guidelines</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat">Operations</td>
              <td class="cmd-name">/start <span class="cmd-arg">&lt;provider&gt; &lt;id&gt;</span></td>
              <td class="cmd-desc">Start a stopped server instance</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/stop <span class="cmd-arg">&lt;provider&gt; &lt;id&gt;</span></td>
              <td class="cmd-desc">Stop a running server instance</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/reboot <span class="cmd-arg">&lt;provider&gt; &lt;id&gt;</span></td>
              <td class="cmd-desc">Reboot a server instance</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat">Monitoring</td>
              <td class="cmd-name">/report</td>
              <td class="cmd-desc">View full metrics summary across all managed VPS</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/bandwidth</td>
              <td class="cmd-desc">View network bandwidth usage breakdown per server</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/docker</td>
              <td class="cmd-desc">View Docker container status across all nodes</td>
            </tr>
            <tr class="cmd-row">
              <td class="cmd-cat"></td>
              <td class="cmd-name">/uptime</td>
              <td class="cmd-desc">View system uptime details for each VPS</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Footer -->
    <footer class="foot">
      <span class="foot-copy">&copy; ${year} <a href="https://github.com/mosabbir-maruf/" target="_blank" rel="noopener">Mosabbir Maruf</a> · <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener">Infra-Bot</a></span>
    </footer>

  </div>

  <script>
    // UTC clock
    function tick() {
      const n = new Date(), p = v => String(v).padStart(2,'0');
      document.getElementById('clock').textContent =
        p(n.getUTCHours())+':'+p(n.getUTCMinutes())+':'+p(n.getUTCSeconds())+' UTC';
    }
    tick(); setInterval(tick, 1000);

    // Uptime counter (from page load)
    const start = Date.now();
    setInterval(() => {
      const s = Math.floor((Date.now()-start)/1000);
      const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
      const p = v => String(v).padStart(2,'0');
      document.getElementById('uptime').textContent = p(h)+'h '+p(m)+'m '+p(sec)+'s';
    }, 1000);

    // Human-readable rendered-at
    const rt = document.getElementById('rendered-at');
    if (rt) {
      try {
        const d = new Date(rt.textContent.trim());
        rt.textContent = d.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC';
      } catch(_) {}
    }

    // Copy to clipboard
    function cp(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('ok');
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.classList.remove('ok');
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 1600);
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
