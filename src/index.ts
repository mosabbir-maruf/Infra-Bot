import './polyfill';

import { Hono } from 'hono';
import { validateEnv, Env } from './config/Env';
import { isAuthorized } from './telegram/middleware/AuthMiddleware';
import { CommandRouter } from './telegram/CommandRouter';
import { Logger } from './utils/Logger';
import { CloudflareKVRateLimiter } from './middleware/RateLimiter';
import { TelegramClient } from './telegram/TelegramClient';
import { TelegramUpdate } from './types';
import { verifyHmacSignature } from './utils/Crypto';
import { MessageRenderer } from './telegram/MessageRenderer';
import { ServerRegistry } from './config/ServerRegistry';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { faviconBase64, favicon32Base64, favicon16Base64 } from './assets/favicon';
import { metaOgBase64 } from './assets/meta-og';

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
  MONITORING_KV?: KVNamespace;
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
        <tr><td colspan="6" class="empty-cell">
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
          : srv.region
            ? `<span>${srv.region}</span>`
            : '<span class="dim">—</span>';

        const providerTag = isAws
          ? '<span class="tag tag-aws">EC2</span>'
          : '<span class="tag tag-do">DO</span>';

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
  const requestUrl = new URL(c.req.url);
  const siteUrl = requestUrl.origin;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Infra-Bot Control Plane — server orchestration, VM power operations, and real-time telemetry.">
  <meta name="robots" content="noindex, nofollow">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteUrl}/">
  <meta property="og:title" content="Infra-Bot · Control Plane">
  <meta property="og:description" content="Infra-Bot Control Plane — server orchestration, VM power operations, and real-time telemetry.">
  <meta property="og:image" content="${siteUrl}/meta-og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${siteUrl}/">
  <meta property="twitter:title" content="Infra-Bot · Control Plane">
  <meta property="twitter:description" content="Infra-Bot Control Plane — server orchestration, VM power operations, and real-time telemetry.">
  <meta property="twitter:image" content="${siteUrl}/meta-og.png">

  <title>Infra-Bot · Control Plane</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:       #f7f5f1;
      --surface:  #eeebe6;
      --border:   #d4d0c8;
      --border2:  #bfbab0;
      --fg:       #1c1a16;
      --fg2:      #5c5850;
      --fg3:      #9a958c;
      --amber:    #a06c0c;
      --amber-d:  rgba(160,108,12,0.1);
      --amber-b:  rgba(160,108,12,0.18);
      --green:    #1f7a44;
      --green-d:  rgba(31,122,68,0.1);
      --aws-c:    #a06c0c;
      --do-c:     #1d4ed8;
      --red:      #b91c1c;
      --red-d:    rgba(185,28,28,0.08);
      --mono:     'Geist Mono', 'JetBrains Mono', monospace;
    }

    .dark {
      --bg:       #0c0b09;
      --surface:  #131210;
      --border:   #252320;
      --border2:  #302e2b;
      --fg:       #e8e4dc;
      --fg2:      #b5afae;
      --fg3:      #7a7670;
      --amber:    #e8a020;
      --amber-d:  rgba(232,160,32,0.08);
      --amber-b:  rgba(232,160,32,0.18);
      --green:    #3dba6e;
      --green-d:  rgba(61,186,110,0.1);
      --aws-c:    #f59e0b;
      --do-c:     #60a5fa;
      --red:      #e05252;
      --red-d:    rgba(224,82,82,0.08);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    *, *::before, *::after { transition: background .2s ease, background-color .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease, fill .2s ease, stroke .2s ease; }
    html { color-scheme: light; }

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
      max-width: 1200px;
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
      justify-content: center;
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
      .page-meta {
        width: 100%;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0.75rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-top: 1rem;
      }
      .page-meta .meta-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      }
      .topbar-right { gap: 0.75rem; }
      .summary { flex-direction: column; }
      .summary-item { border-right: none; border-bottom: 1px solid var(--border); }
      .s-val { font-size: 1.1rem; }
      .sys-grid { grid-template-columns: repeat(2, 1fr); }
      .sys-item:nth-child(2) { border-right: none; }
      .tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table th:nth-child(4), table td:nth-child(4) { display: none; }
      table th, table td { padding: 0.5rem 0.6rem; font-size: 0.76rem; }
      .id-wrap { font-size: 0.72rem; }
      .cmd-table th:first-child,
      .cmd-table .cmd-cat { display: none; }
      .cmd-name { width: auto; min-width: 9rem; }
      .cmd-desc { min-width: 8rem; }
      .foot-links { gap: 0.75rem; }
      .hide-mobile { display: none; }
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
      <a href="/health" class="nav-link hide-mobile" target="_blank" rel="noopener">health ↗</a>
      <a href="https://workers.cloudflare.com" target="_blank" rel="noopener" class="nav-link hide-mobile">cf workers ↗</a>
      <a href="/docs" class="nav-link">docs</a>
      <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener" class="nav-link" aria-label="GitHub repo"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
      <button id="theme-btn" class="nav-link" style="background:none;border:none;cursor:pointer;padding:0;display:inline-flex;align-items:center" aria-label="Toggle theme">
        <svg class="theme-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="theme-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
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
    (() => {
      const p = v => String(v).padStart(2,'0');
      const start = Date.now();

      function tick() {
        const n = new Date();
        const t = p(n.getUTCHours())+':'+p(n.getUTCMinutes())+':'+p(n.getUTCSeconds())+' UTC';
        document.getElementById('clock').textContent = t;
        const dc = document.getElementById('clock-docs');
        if (dc) dc.textContent = t;

        const s = Math.floor((Date.now()-start)/1000);
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
        document.getElementById('uptime').textContent = p(h)+'h '+p(m)+'m '+p(sec)+'s';
      }
      tick();
      setInterval(tick, 1000);
    })();

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

    // Theme toggle
    (function(){
      const btn=document.getElementById('theme-btn');
      if(!btn)return;
      const key='infra-bot-theme';
      const setTheme=(dark)=>{
        document.documentElement.classList.toggle('dark',dark);
        const sun=btn.querySelector('.theme-sun');
        const moon=btn.querySelector('.theme-moon');
        if(sun)sun.style.display=dark?'':'none';
        if(moon)moon.style.display=dark?'none':'';
        try{localStorage.setItem(key,dark?'dark':'light')}catch(e){}
      };
      try{
        const saved=localStorage.getItem(key);
        if(saved==='dark')setTheme(true);
      }catch(e){}
      btn.addEventListener('click',()=>{
        setTheme(!document.documentElement.classList.contains('dark'));
      });
    })();
  </script>
</body>
</html>`;

  return c.html(htmlContent, 200);
});
// Documentation page
app.get('/docs', (c) => {
  const year = new Date().getFullYear();
  const requestUrl = new URL(c.req.url);
  const siteUrl = requestUrl.origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Infra-Bot Documentation — server registry configurations, deployment operations, and monitoring integration guides.">
  <meta name="robots" content="noindex, nofollow">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteUrl}/docs">
  <meta property="og:title" content="Infra-Bot · Documentation">
  <meta property="og:description" content="Infra-Bot Documentation — server registry configurations, deployment operations, and monitoring integration guides.">
  <meta property="og:image" content="${siteUrl}/meta-og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${siteUrl}/docs">
  <meta property="twitter:title" content="Infra-Bot · Documentation">
  <meta property="twitter:description" content="Infra-Bot Documentation — server registry configurations, deployment operations, and monitoring integration guides.">
  <meta property="twitter:image" content="${siteUrl}/meta-og.png">

  <title>Infra-Bot · Documentation</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f7f5f1; --surface: #eeebe6; --sidebar: #f2efeb;
      --border: #d4d0c8; --border2: #bfbab0;
      --fg: #1c1a16; --fg2: #5c5850; --fg3: #9a958c;
      --amber: #a06c0c; --amber-d: rgba(160,108,12,0.1); --amber-b: rgba(160,108,12,0.18);
      --green: #1f7a44; --mono: 'Geist Mono','JetBrains Mono',monospace;
    }
    .dark {
      --bg: #0c0b09; --surface: #131210; --sidebar: #0e0d0b;
      --border: #252320; --border2: #302e2b;
      --fg: #e8e4dc; --fg2: #b5afae; --fg3: #7a7670;
      --amber: #e8a020; --amber-d: rgba(232,160,32,0.08); --amber-b: rgba(232,160,32,0.18);
      --green: #3dba6e;
    }
    *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
    *,*::before,*::after { transition:background .2s ease,background-color .2s ease,color .2s ease,border-color .2s ease,box-shadow .2s ease,fill .2s ease,stroke .2s ease; }
    html { color-scheme:light; scroll-behavior:smooth; }
    body {
      font-family:'Geist','Inter',system-ui,sans-serif;
      background:var(--bg); color:var(--fg);
      min-height:100vh; font-size:14px; line-height:1.7;
      -webkit-font-smoothing:antialiased;
    }
    .topbar {
      position:sticky; top:0; z-index:50;
      background:var(--bg); border-bottom:1px solid var(--border);
      display:flex; align-items:center; justify-content:space-between;
      padding:0 2rem; height:48px;
    }
    .wordmark { font-family:var(--mono); font-size:0.8rem; font-weight:500; color:var(--fg); display:flex; align-items:center; gap:0.5rem; text-decoration:none; }
    .wordmark-sep { color:var(--fg3); font-weight:300; }
    .wordmark-sub { color:var(--fg2); font-weight:400; }
    .topbar-left { display:flex; align-items:center; gap:0.75rem; }
    .topbar-right { display:flex; align-items:center; gap:1.25rem; }
    .topbar-status { display:flex; align-items:center; gap:0.4rem; font-size:0.72rem; color:var(--green); font-family:var(--mono); }
    .dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--green); flex-shrink:0; animation:blink 3s ease-in-out infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.35} }
    .clock { font-family:var(--mono); font-size:0.72rem; color:var(--fg2); letter-spacing:0.02em; }
    .nav-link { font-size:0.72rem; color:var(--fg2); text-decoration:none; transition:color .12s; display:inline-flex; align-items:center; gap:.25rem; }
    .nav-link svg { display:block; }
    .nav-link:hover { color:var(--fg); }

    .doc-layout {
      display:flex;
      width:100%;
      min-height:calc(100vh - 48px);
    }
    /* Left sidebar */
    .doc-sidebar {
      width:290px;
      flex-shrink:0;
      position:sticky;
      top:48px;
      height:calc(100vh - 48px);
      overflow-y:auto;
      padding:2rem 1rem 2rem 1.5rem;
      border-right:1px solid var(--border);
      background:var(--sidebar);
    }
    .doc-sidebar-label {
      font-size:0.6rem;
      text-transform:uppercase;
      letter-spacing:0.1em;
      color:var(--fg3);
      font-weight:500;
      margin-bottom:0.75rem;
    }
    .doc-sidebar nav { display:flex; flex-direction:column; gap:0.15rem; }
    .doc-sidebar a {
      font-size:0.78rem;
      color:var(--fg2);
      text-decoration:none;
      padding:0.25rem 0.5rem;
      border-radius:3px;
      transition:color .12s, background .12s;
      font-family:var(--mono);
    }
    .doc-sidebar a:hover { color:var(--amber); background:var(--amber-d); }
    .doc-sidebar a.active { color:var(--amber); background:var(--amber-d); font-weight:500; }

    /* Main content */
    .doc-content {
      flex:1;
      max-width:1150px;
      margin:0 auto;
      min-width:0;
      padding:2.5rem 2rem 6rem;
      display:flex;
      flex-direction:column;
      gap:2.5rem;
    }
    .page-hdr { padding-bottom:1.25rem; border-bottom:1px solid var(--border); }
    .page-title { font-size:1.5rem; font-weight:500; letter-spacing:-.03em; color:var(--fg); }
    .page-title span { color:var(--amber); }
    .page-sub { font-size:0.78rem; color:var(--fg2); margin-top:0.3rem; }

    .section { display:flex; flex-direction:column; gap:1rem; scroll-margin-top:4rem; }
    .section-label {
      font-size:0.67rem; text-transform:uppercase; letter-spacing:0.1em;
      color:var(--fg3); font-weight:500; display:flex; align-items:center; gap:0.75rem;
    }
    .section-label::after { content:''; flex:1; height:1px; background:var(--border); }
    .section h2 { font-size:1.1rem; font-weight:500; color:var(--fg); margin-top:0.5rem; }
    .section h3 { font-size:0.92rem; font-weight:500; color:var(--amber); margin-top:0.5rem; }
    .section p,.section li { font-size:0.85rem; color:var(--fg2); line-height:1.7; }
    .section ul,.section ol { padding-left:1.25rem; display:flex; flex-direction:column; gap:0.35rem; }
    .section a { color:var(--amber); text-decoration:none; border-bottom:1px solid transparent; transition:border-color .12s; }
    .section a:hover { border-bottom-color:var(--amber); }
    .section strong { color:var(--fg); font-weight:500; }
    .section code {
      font-family:var(--mono); font-size:0.78rem;
      background:var(--surface); padding:0.1rem 0.35rem; border-radius:3px;
      border:1px solid var(--border); color:var(--amber);
    }
    .section pre {
      background:var(--surface); border:1px solid var(--border); border-radius:6px;
      padding:1rem 1.25rem; overflow-x:auto; -webkit-overflow-scrolling:touch;
      font-family:var(--mono); font-size:0.78rem; line-height:1.6;
    }
    .section pre code { background:none; border:none; padding:0; color:var(--fg2); }

    .tbl-wrap { border:1px solid var(--border); border-radius:6px; overflow:hidden; overflow-x:auto; }
    .tbl-wrap table { width:100%; border-collapse:collapse; }
    .tbl-wrap thead { background:var(--surface); border-bottom:1px solid var(--border); }
    .tbl-wrap th {
      font-size:0.62rem; text-transform:uppercase; letter-spacing:0.08em;
      color:var(--fg3); font-weight:500; padding:0.55rem 1rem; text-align:left; white-space:nowrap;
    }
    .tbl-wrap th:first-child { padding-left:1.25rem; }
    .tbl-wrap td { padding:0.55rem 1rem; font-size:0.82rem; color:var(--fg2); vertical-align:middle; }
    .tbl-wrap td:first-child { padding-left:1.25rem; }
    .tbl-wrap tr { border-bottom:1px solid var(--border); }
    .tbl-wrap tr:last-child { border-bottom:none; }
    .tbl-wrap td code { font-size:0.75rem; }
    .tag { font-family:var(--mono); font-size:0.6rem; font-weight:500; padding:0.12rem 0.4rem; border-radius:3px; letter-spacing:0.04em; white-space:nowrap; }
    .tag-req { background:rgba(224,82,82,0.1); color:#e05252; border:1px solid rgba(224,82,82,0.2); }
    .tag-opt { background:rgba(61,186,110,0.1); color:var(--green); border:1px solid rgba(61,186,110,0.2); }
    .tag-rec { background:var(--amber-d); color:var(--amber); border:1px solid var(--amber-b); }
    .warning { background:rgba(224,82,82,0.06); border-left:3px solid #e05252; padding:0.75rem 1rem; border-radius:0 4px 4px 0; font-size:0.82rem; color:var(--fg2); }
    .warning strong { color:#e05252; }

    /* Right sidebar - On this page */
    .doc-toc {
      width:270px;
      flex-shrink:0;
      position:sticky;
      top:48px;
      height:fit-content;
      max-height:calc(100vh - 80px);
      overflow-y:auto;
      padding:2rem 1.25rem 2rem 1rem;
      border-left:1px solid var(--border);
      scrollbar-width:none; /* Firefox */
    }
    .doc-toc::-webkit-scrollbar {
      display:none; /* Chrome/Safari/Webkit */
    }
    .doc-toc-label {
      font-size:0.6rem;
      text-transform:uppercase;
      letter-spacing:0.1em;
      color:var(--fg3);
      font-weight:500;
      margin-bottom:0.75rem;
    }
    .doc-toc nav { display:flex; flex-direction:column; gap:0.25rem; }
    .doc-toc a {
      font-size:0.72rem;
      color:var(--fg3);
      text-decoration:none;
      padding:0.15rem 0;
      transition:color .12s;
    }
    .doc-toc a.toc-sec {
      font-weight:500;
      font-size:0.74rem;
      color:var(--fg2);
      margin-top:0.4rem;
    }
    .doc-toc a.toc-sub {
      font-size:0.68rem;
      color:var(--fg3);
      padding-left:0.6rem;
      opacity:0.85;
    }
    .doc-toc a.toc-h3 {
      padding-left:1.1rem;
    }
    .doc-toc a:hover { color:var(--amber); opacity:1; }
    .doc-toc a.active { color:var(--amber); font-weight:500; opacity:1; }
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

    .foot { display:flex; align-items:center; justify-content:center; gap:1rem; flex-wrap:wrap; padding-top:1.5rem; border-top:1px solid var(--border); }
    .foot-copy { font-size:0.7rem; color:var(--fg2); font-family:var(--mono); }
    .foot-copy a { text-decoration:none; color:inherit; }
    ::-webkit-scrollbar { width:5px; height:5px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }

    .hamburger {
      display:none; background:none; border:none; cursor:pointer;
      padding:4px; color:var(--fg2); transition:color .12s;
    }
    .hamburger:hover { color:var(--fg); }
    .mobile-overlay {
      display:none; position:fixed; inset:0; z-index:60;
      background:rgba(0,0,0,0.5);
    }
    .mobile-overlay.open { display:block; }
    .mobile-nav {
      position:fixed; top:0; left:-280px; bottom:0; width:260px;
      z-index:70; background:var(--sidebar); border-right:1px solid var(--border);
      padding:1.25rem 1rem; overflow-y:auto;
      transition:left .25s ease; display:flex; flex-direction:column; gap:0.25rem;
    }
    .mobile-nav.open { left:0; }
    .mobile-nav-label {
      font-size:0.6rem; text-transform:uppercase; letter-spacing:0.1em;
      color:var(--fg3); font-weight:500; margin-bottom:0.5rem; margin-top:0.5rem;
    }
    .mobile-nav-divider {
      height: 1px;
      background: var(--border);
      margin: 1.25rem 0.5rem 0.75rem;
    }
    .mobile-nav a {
      font-size:0.78rem; color:var(--fg2); text-decoration:none;
      padding:0.4rem 0.5rem; border-radius:3px; font-family:var(--mono);
      transition:color .12s, background .12s;
    }
    .mobile-nav a:hover { color:var(--amber); background:var(--amber-d); }
    .mobile-nav-close {
      align-self:flex-end; background:none; border:none; cursor:pointer;
      color:var(--fg2); padding:4px; margin-bottom:0.25rem;
    }
    .mobile-nav-close:hover { color:var(--fg); }

    @media (max-width:1024px) {
      .doc-toc { display:none; }
    }
    @media (max-width:768px) {
      .hamburger { display:inline-flex; align-items:center; }
      .doc-sidebar { display:none; }
      .topbar { padding:0 0.75rem; }
      .doc-content { padding:1.5rem 1rem 4rem; gap:2rem; }
    }
    @media (max-width:640px) {
      .clock { display:none; }
      .hide-mobile { display:none; }
      .page-title { font-size:1.2rem; }
      .section pre { padding:0.75rem 1rem; font-size:0.74rem; }
      .section h2 { font-size:1rem; }
      .section h3 { font-size:0.85rem; }
      .tbl-wrap th, .tbl-wrap td { padding:0.4rem 0.6rem; font-size:0.75rem; }
      .tbl-wrap th:first-child, .tbl-wrap td:first-child { padding-left:0.75rem; }
    }
    @media (max-width:480px) {
      .wordmark-sub { display:none; }
      .foot-copy { font-size:0.62rem; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <button class="hamburger" id="hamburger-docs" aria-label="Open navigation">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <a href="/" class="wordmark">
        <span>infra-bot</span>
        <span class="wordmark-sep">/</span>
        <span class="wordmark-sub">docs</span>
      </a>
      <div class="topbar-status">
        <span class="dot"></span>
        operational
      </div>
    </div>
    <div class="topbar-right">
      <span class="clock" id="clock-docs">--:--:-- UTC</span>
      <a href="/" class="nav-link">dashboard</a>
      <a href="/health" class="nav-link hide-mobile" target="_blank" rel="noopener">health ↗</a>
      <a href="https://workers.cloudflare.com" target="_blank" rel="noopener" class="nav-link hide-mobile">cf workers ↗</a>
      <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener" class="nav-link" aria-label="GitHub repo"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
      <button id="theme-btn" class="nav-link" style="background:none;border:none;cursor:pointer;padding:0;display:inline-flex;align-items:center" aria-label="Toggle theme">
        <svg class="theme-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="theme-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </div>
  </div>

  <div class="mobile-overlay" id="mobile-overlay-docs"></div>
  <div class="mobile-nav" id="mobile-nav-docs">
    <button class="mobile-nav-close" id="mobile-nav-close-docs" aria-label="Close navigation">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="mobile-nav-label">Sections</div>
    <a href="#architecture">architecture</a>
    <a href="#commands">commands</a>
    <a href="#config">configuration</a>
    <a href="#env">environment</a>
    <a href="#providers">providers</a>
    <a href="#security">security</a>
    <a href="#webhook">webhook</a>
    <a href="#rate-limit">rate limit</a>
    <a href="#monitoring">monitoring</a>
    <a href="#deployment">deployment</a>
    <a href="#recovery">recovery</a>
    <div class="mobile-nav-divider"></div>
    <div class="mobile-nav-label">Navigation</div>
    <a href="/">dashboard</a>
    <a href="/health" target="_blank" rel="noopener">health ↗</a>
    <a href="https://workers.cloudflare.com" target="_blank" rel="noopener">cf workers ↗</a>
    <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener">github repo ↗</a>
  </div>
  <div class="doc-layout">
    <aside class="doc-sidebar">
      <div class="doc-sidebar-label">Sections</div>
      <nav>
        <a href="#architecture">architecture</a>
        <a href="#commands">commands</a>
        <a href="#config">configuration</a>
        <a href="#env">environment</a>
        <a href="#providers">providers</a>
        <a href="#security">security</a>
        <a href="#webhook">webhook</a>
        <a href="#rate-limit">rate limit</a>
        <a href="#monitoring">monitoring</a>
        <a href="#deployment">deployment</a>
        <a href="#recovery">recovery</a>
      </nav>
    </aside>

    <main class="doc-content">
      <div class="page-hdr">
        <div class="page-title">documentation</div>
        <div class="page-sub">Infra-Bot Control Plane — setup, configuration &amp; reference</div>
      </div>

      <div class="section" id="architecture">
        <div class="section-label">architecture</div>
        <p>The Control Plane is a <strong>production-grade, vendor-independent edge service</strong> on Cloudflare Workers managing VPS infrastructure across <strong>AWS EC2</strong> and <strong>DigitalOcean</strong> via Telegram.</p>
        <h2 id="arch-design">Key Design Decisions</h2>
        <ul>
          <li><strong>Edge serverless</strong> — No VMs to maintain. Immune to datacenter outages. Cost efficient with high free-tier.</li>
          <li><strong>Complete decoupling</strong> — Queries VM state directly from provider APIs. Can boot/reboot even a fully powered-down VPS.</li>
          <li><strong>Provider abstraction</strong> — Unified <code>CloudProvider</code> interface. Adding GCP/Azure/Hetzner requires only implementing the interface.</li>
          <li><strong>Config-driven registry</strong> — Friendly aliases instead of raw instance IDs. Git-controlled, zero database overhead.</li>
        </ul>
      </div>

      <div class="section" id="commands">
        <div class="section-label">bot commands</div>
        <p>Case-insensitive. Syntax: <code>/command &lt;alias&gt;</code>.</p>
        <h2 id="cmds-info">Info &amp; Health</h2>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Command</th><th>Description</th><th>Args</th></tr></thead>
            <tbody>
              <tr><td><code>/status</code></td><td>List all servers or query a specific alias</td><td><code>&lt;alias&gt;</code> <span class="tag tag-opt">opt</span></td></tr>
              <tr><td><code>/health</code></td><td>Check control plane, providers, KV, authorized users</td><td>—</td></tr>
              <tr><td><code>/help</code></td><td>Show available commands and usage</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
        <h2 id="cmds-ops">Operations</h2>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Command</th><th>Description</th><th>Args</th></tr></thead>
            <tbody>
              <tr><td><code>/start</code></td><td>Start a stopped instance</td><td><code>&lt;alias&gt;</code> <span class="tag tag-opt">opt</span></td></tr>
              <tr><td><code>/stop</code></td><td>Power off (releases capacity — high risk)</td><td><code>&lt;alias&gt;</code> <span class="tag tag-req">req</span></td></tr>
              <tr><td><code>/reboot</code></td><td>Reboot / power-cycle (preferred over stop)</td><td><code>&lt;alias&gt;</code> <span class="tag tag-req">req</span></td></tr>
            </tbody>
          </table>
        </div>
        <div class="warning"><strong>Warning:</strong> Stopping EC2 releases physical hardware. Restart may fail with <code>InsufficientInstanceCapacity</code>. Prefer <code>/reboot</code>.</div>
        <h2 id="cmds-mon">Monitoring (KV-dependent)</h2>
        <p>Reads telemetry from <code>MONITORING_KV</code> at <code>metrics:&lt;alias&gt;</code>. Requires agent on each server.</p>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Command</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>/report</code></td><td>Full metrics (CPU, RAM, Disk, Uptime, Docker)</td></tr>
              <tr><td><code>/bandwidth</code></td><td>Monthly bandwidth (rx/tx, progress bar)</td></tr>
              <tr><td><code>/docker</code></td><td>Container status (running/total/unhealthy)</td></tr>
              <tr><td><code>/uptime</code></td><td>Uptime per VPS (&gt;15 min = stale)</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section" id="config">
        <div class="section-label">server configuration</div>
        <p><code>SERVERS_CONFIG</code> is a flat JSON object keyed by alias. Only servers listed here appear on the dashboard and are addressable by Telegram commands — the bot does not auto-discover instances from cloud provider APIs.</p>
        <h2 id="config-aws">AWS EC2</h2>
        <pre><code>{
  "ai-gateway-prod": {
    "provider": "aws",
    "region": "ap-south-1",
    "instanceId": "i-0123456789abcdef0"
  }
}</code></pre>
        <h2 id="config-do">DigitalOcean</h2>
        <p>Find your droplet ID and region in the Control Panel (<code>cloud.digitalocean.com/droplets/&lt;id&gt;</code>), or via <code>doctl compute droplet list</code>. <code>region</code> is optional — if omitted the dashboard shows <code>—</code>.</p>
        <pre><code>{
  "docs-server": {
    "provider": "digitalocean",
    "dropletId": "123456789",
    "region": "nyc3"
  }
}</code></pre>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Field</th><th>Req</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td><code>provider</code></td><td><span class="tag tag-req">req</span></td><td><code>aws</code>, <code>digitalocean</code>, <code>do</code></td></tr>
              <tr><td><code>instanceId</code></td><td><span class="tag tag-req">req</span></td><td>AWS EC2 instance ID</td></tr>
              <tr><td><code>region</code></td><td><span class="tag tag-opt">opt</span></td><td>Defaults to <code>AWS_REGION</code></td></tr>
              <tr><td><code>dropletId</code></td><td><span class="tag tag-req">req</span></td><td>DO droplet ID (string/number)</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section" id="env">
        <div class="section-label">environment variables</div>
        <p>Set via Cloudflare Dashboard or CLI. Secrets use <code>npx wrangler secret put</code>; plain-text vars use <code>wrangler.toml</code> <code>[vars]</code> or the Dashboard.</p>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Variable</th><th>Req</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td><code>TELEGRAM_BOT_TOKEN</code></td><td><span class="tag tag-req">req</span></td><td>From BotFather</td></tr>
              <tr><td><code>AUTHORIZED_USER_IDS</code></td><td><span class="tag tag-req">req</span></td><td>Comma-separated Telegram user IDs</td></tr>
              <tr><td><code>SERVERS_CONFIG</code></td><td><span class="tag tag-req">req</span></td><td>Server registry JSON</td></tr>
              <tr><td><code>MONITORING_SECRET</code></td><td><span class="tag tag-req">req</span></td><td>HMAC-SHA256 secret for telemetry</td></tr>
              <tr><td><code>AWS_ACCESS_KEY_ID</code></td><td><span class="tag tag-opt">opt</span></td><td>AWS IAM access key</td></tr>
              <tr><td><code>AWS_SECRET_ACCESS_KEY</code></td><td><span class="tag tag-opt">opt</span></td><td>AWS IAM secret key</td></tr>
              <tr><td><code>AWS_REGION</code></td><td><span class="tag tag-opt">opt</span></td><td>Plain-text variable. Default: <code>us-east-1</code></td></tr>
              <tr><td><code>DIGITALOCEAN_TOKEN</code></td><td><span class="tag tag-opt">opt</span></td><td>DO personal access token</td></tr>
              <tr><td><code>TELEGRAM_WEBHOOK_SECRET</code></td><td><span class="tag tag-rec">rec</span></td><td>Webhook header validation</td></tr>
            </tbody>
          </table>
        </div>
        <h2 id="env-kv">KV Bindings</h2>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Binding</th><th>Req</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td><code>MONITORING_KV</code></td><td><span class="tag tag-rec">rec</span></td><td>Telemetry storage &amp; alert dedup</td></tr>
              <tr><td><code>RATE_LIMIT_KV</code></td><td><span class="tag tag-opt">opt</span></td><td>Distributed rate limiting</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section" id="providers">
        <div class="section-label">providers</div>
        <h2 id="providers-aws">AWS EC2</h2>
        <p>Uses <code>@aws-sdk/client-ec2</code>. Restricted IAM user policy:</p>
        <pre><code>{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InstancePowerOperations",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances"
      ],
      "Resource": [
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0"
      ]
    },
    {
      "Sid": "InstanceDescribeAndTelemetry",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}</code></pre>
        <p>Status mapping: <code>pending</code>➔starting, <code>running</code>➔running, <code>stopping</code>➔stopping, <code>stopped</code>➔stopped, <code>shutting-down/terminated</code>➔terminated.</p>

        <h2 id="providers-do">DigitalOcean</h2>
        <p>REST at <code>https://api.digitalocean.com/v2</code>, <code>Authorization: Bearer &lt;token&gt;</code>.</p>
        <p>Use <strong>Custom Scopes</strong> &mdash; select only <code>droplet:read</code> + <code>droplet:update</code>. DO auto-adds <code>regions:read</code>, <code>sizes:read</code>, <code>actions:read</code>, <code>image:read</code>, <code>snapshot:read</code>. Do <strong>not</strong> use Full Access tokens in production bots (<a href="#security">see security warning</a>).</p>
        <ol>
          <li>API → Tokens/Keys → Generate New Token → Custom Scopes</li>
          <li>Select <code>droplet</code> → <strong>read</strong> + <strong>update</strong> only</li>
          <li>Set as <code>DIGITALOCEAN_TOKEN</code> secret</li>
        </ol>
        <p>Actions: <code>power_on</code> <code>power_off</code> <code>reboot</code>. Status: <code>new</code>→starting, <code>active</code>→running, <code>off</code>→stopped, <code>archive</code>→terminated.</p>
      </div>

      <div class="section" id="security">
        <div class="section-label">authentication &amp; security</div>
        <h2 id="sec-webhook">Webhook Source Validation</h2>
        <p><code>TELEGRAM_WEBHOOK_SECRET</code> matched against <code>X-Telegram-Bot-Api-Secret-Token</code> header. Mismatch returns <code>403</code>.</p>
        <h2 id="sec-whitelist">Whitelisted Access</h2>
        <p>Only <code>AUTHORIZED_USER_IDS</code> can execute commands. Unauthorized messages are silently dropped (<code>200 OK</code>, no reply) to prevent reconnaissance.</p>
        <h2 id="sec-hmac">HMAC-Signed Telemetry</h2>
        <p><code>X-Signature</code> (HMAC-SHA256) + <code>X-Server-Alias</code> headers. Replay protection rejects payloads with clock drift &gt;300s.</p>
      </div>

      <div class="section" id="webhook">
        <div class="section-label">webhook setup</div>
        <pre><code>curl -F "url=https://&lt;worker&gt;.workers.dev/webhook" \\
     -F "secret_token=&lt;TOKEN&gt;" \\
     https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook</code></pre>
        <p>Verify: <code>curl .../getWebhookInfo</code>. Clear pending: <code>curl .../deleteWebhook?drop_pending_updates=true</code>.</p>
      </div>

      <div class="section" id="rate-limit">
        <div class="section-label">rate limiting</div>
        <p><strong>10 commands / 60s</strong> per user. Uses <code>RATE_LIMIT_KV</code>; falls back to in-memory. Exceeded users receive a warning and are blocked for the window. Key: <code>rl:&lt;userId&gt;</code>, 60s TTL.</p>
      </div>

      <div class="section" id="monitoring">
        <div class="section-label">monitoring &amp; telemetry</div>
        <h2 id="mon-arch">Architecture</h2>
        <p>Push-based. Every 5 minutes, <code>agent.sh</code> collects metrics and posts to <code>POST /monitoring/report</code> with HMAC signing. Stored in <code>MONITORING_KV</code> under <code>metrics:&lt;alias&gt;</code>.</p>

        <h2 id="mon-agent">Agent Setup</h2>
        <p>Create the agent script and configuration file:</p>
        <pre><code>sudo nano /usr/local/bin/infra-agent.sh</code></pre>
        <p>Copy the contents of <a href="https://github.com/mosabbir-maruf/Infra-Bot/blob/main/monitoring/agent.sh" target="_blank" rel="noopener"><code>monitoring/agent.sh</code></a> from the repo, paste, and save. Then create the config:</p>
        <pre><code>sudo nano /etc/infra-agent.conf</code></pre>
        <p>Paste the following (replace with your values):</p>
        <pre><code>SERVER_ALIAS="ai-gateway-prod"
MONITORING_SECRET="your_shared_hmac_secret"
CONTROL_PLANE_URL="https://your-worker.workers.dev"</code></pre>
        <p>Make the script executable:</p>
        <pre><code>sudo chmod +x /usr/local/bin/infra-agent.sh</code></pre>
        <p>Add the cron job (runs every 5 minutes):</p>
        <pre><code>*/5 * * * * . /etc/infra-agent.conf; export SERVER_ALIAS MONITORING_SECRET CONTROL_PLANE_URL; /usr/local/bin/infra-agent.sh &gt;/dev/null 2&gt;&amp;1</code></pre>
        <p>Requires: <code>bash</code>, <code>curl</code>, <code>openssl</code>, <code>vnstat</code>, <code>docker</code> (optional).</p>

        <h2 id="mon-alerts">Bandwidth Alerts</h2>
        <p>Thresholds: <strong>50 GB</strong>, <strong>80 GB</strong>, <strong>95 GB</strong>. Dedup via <code>alert:&lt;alias&gt;:&lt;threshold&gt;:&lt;yyyy-mm&gt;</code> with 30-day TTL.</p>

        <h2 id="mon-cron">Cron Report</h2>
        <p>Daily at <strong>08:00 UTC</strong>. Summarizes all servers, marks telemetry &gt;15 min as stale.</p>

        <h2 id="mon-recovery">Recovery</h2>
        <p>Stale server? SSH in, check <code>grep CRON /var/log/syslog</code>, run agent manually. Clock drift? <code>sudo systemctl restart systemd-timesyncd</code>. Rotate secret: <code>openssl rand -hex 24</code>, <code>wr secret put</code>, update agent configs.</p>
      </div>

      <div class="section" id="deployment">
        <div class="section-label">deployment</div>
        <h2 id="deploy-dash">Cloudflare Dashboard</h2>
        <ol>
          <li>Fork repo, connect Workers &amp; Pages → Create → Connect to Git</li>
          <li>Create KV namespace, bind as <code>MONITORING_KV</code></li>
          <li>Set variables, encrypt sensitive ones, Save &amp; Deploy</li>
        </ol>
        <h2 id="deploy-cli">Wrangler CLI</h2>
        <pre><code>npx wrangler login
npx wrangler kv namespace create MONITORING_KV
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put AUTHORIZED_USER_IDS
npx wrangler secret put MONITORING_SECRET
npx wrangler secret put SERVERS_CONFIG
npm run deploy</code></pre>
        <p>After creating the KV namespace, bind it in the Dashboard (<strong>Workers → your worker → Settings → Variables → KV Namespace Bindings</strong>). Do <strong>not</strong> add the namespace ID to <code>wrangler.toml</code> — it is account-specific and breaks portability.</p>
        <h2 id="deploy-verify">Verify</h2>
        <ul>
          <li><code>GET /health</code> → <code>{"status":"ok"}</code></li>
          <li><code>GET /</code> → dashboard with nodes</li>
          <li>Send <code>/status</code> in Telegram</li>
        </ul>
        <h2 id="deploy-rollback">Rollback</h2>
        <p>Dashboard → Deployments → Rollback. CLI: <code>npx wrangler rollback &lt;ID&gt;</code>.</p>
      </div>

      <div class="section" id="recovery">
        <div class="section-label">disaster recovery</div>
        <h2 id="dr-credentials">Credential Rotation</h2>
        <ul>
          <li><strong>Telegram:</strong> <code>/revoke</code> with BotFather, update secret, re-register webhook</li>
          <li><strong>AWS:</strong> Delete compromised key in IAM, generate new, update secrets</li>
          <li><strong>DO:</strong> Revoke token in API settings, generate new, update secret</li>
        </ul>
        <h2 id="dr-webhook">Webhook Troubleshooting</h2>
        <ol>
          <li>Check <code>getWebhookInfo</code> — verify URL, <code>last_error_message</code></li>
          <li><code>npx wrangler tail</code> — look for 403, rejected requests, missing secrets</li>
          <li>SSL: Cloudflare SSL/TLS → Full (Strict)</li>
          <li>Clear queue: <code>deleteWebhook?drop_pending_updates=true</code>, re-register</li>
        </ol>
      </div>

      <footer class="foot">
        <span class="foot-copy">&copy; ${year} <a href="https://github.com/mosabbir-maruf/" target="_blank" rel="noopener">Mosabbir Maruf</a> · <a href="https://github.com/mosabbir-maruf/Infra-Bot" target="_blank" rel="noopener">Infra-Bot</a></span>
      </footer>
    </main>

    <aside class="doc-toc">
      <div class="doc-toc-label">On this page</div>
      <nav id="toc"></nav>
    </aside>
  </div>
  <script>
    (()=>{
      const toc=document.getElementById('toc');
      const sections=document.querySelectorAll('.section');
      if(!toc||!sections.length)return;

      let currentActiveSectionId = '';

      const handleScroll = () => {
        let activeEl = null;
        let minDistance = Infinity;
        const threshold = 120; // Active scanning line in pixels from viewport top
        
        // Check sections first
        sections.forEach(sec => {
          const rect = sec.getBoundingClientRect();
          const dist = Math.abs(rect.top - threshold);
          if (rect.top <= threshold + 50 && rect.bottom >= threshold) {
            if (dist < minDistance) {
              minDistance = dist;
              activeEl = sec;
            }
          }
        });
        
        // Also check all subheadings inside sections for finer precision
        const allHeadings = document.querySelectorAll('.section h2, .section h3');
        allHeadings.forEach(h => {
          if (!h.id) return;
          const rect = h.getBoundingClientRect();
          const dist = Math.abs(rect.top - threshold);
          if (rect.top <= threshold + 50 && rect.bottom >= 0) {
            if (dist < minDistance) {
              minDistance = dist;
              activeEl = h;
            }
          }
        });
        
        // Fallback for page boundaries: if we are at the very bottom, activate the absolute last item
        const isAtBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 30);
        if (isAtBottom) {
          const allSpyable = [];
          sections.forEach(sec => {
            allSpyable.push(sec);
            sec.querySelectorAll('h2, h3').forEach(h => {
              if (h.id) allSpyable.push(h);
            });
          });
          if (allSpyable.length > 0) {
            activeEl = allSpyable[allSpyable.length - 1];
          }
        }
        
        if (activeEl) {
          let activeSection = null;
          let activeHeading = null;
          
          if (activeEl.classList.contains('section')) {
            activeSection = activeEl;
          } else {
            activeHeading = activeEl;
            activeSection = activeEl.closest('.section');
          }
          
          if (activeSection) {
            const activeSectionId = activeSection.id;
            
            // Rebuild TOC if the section changes
            if (activeSectionId !== currentActiveSectionId) {
              currentActiveSectionId = activeSectionId;
              toc.innerHTML = '';
              const headings = activeSection.querySelectorAll('h2, h3');
              headings.forEach(h => {
                if (!h.id) return;
                const subLink = document.createElement('a');
                subLink.href = '#' + h.id;
                subLink.textContent = h.textContent.trim();
                subLink.className = h.tagName.toLowerCase() === 'h2' ? 'toc-sub toc-h2' : 'toc-sub toc-h3';
                toc.appendChild(subLink);
              });
            }
            
            // Highlight current heading in TOC
            const activeHeadingId = activeHeading ? activeHeading.id : '';
            const tocLinks = toc.querySelectorAll('a');
            tocLinks.forEach(a => {
              const href = a.getAttribute('href') || '';
              a.classList.toggle('active', !!(activeHeadingId && href.endsWith('#' + activeHeadingId)));
            });
            
            // Highlight active section in left sidebar & mobile nav
            const sidebarLinks = document.querySelectorAll('.doc-sidebar a, .mobile-nav a');
            sidebarLinks.forEach(a => {
              const href = a.getAttribute('href') || '';
              a.classList.toggle('active', href.endsWith('#' + activeSectionId));
            });
          }
        }
      };

      window.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();

      // Add copy buttons to all pre elements in documentation
      document.querySelectorAll('.section pre').forEach(pre => {
        pre.style.position = 'relative';
        
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.title = 'Copy code';
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        btn.style.position = 'absolute';
        btn.style.top = '8px';
        btn.style.right = '8px';
        btn.style.zIndex = '10';
        
        btn.addEventListener('click', () => {
          // Exclude the button text itself if any
          const codeEl = pre.querySelector('code');
          const text = (codeEl ? codeEl.innerText : pre.innerText).trim();
          navigator.clipboard.writeText(text).then(() => {
            btn.classList.add('ok');
            btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
            setTimeout(() => {
              btn.classList.remove('ok');
              btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
            }, 1600);
          });
        });
        
        pre.appendChild(btn);
      });

      const btn=document.getElementById('theme-btn');
      if(btn){
        const key='infra-bot-theme';
        const setTheme=d=>{
          document.documentElement.classList.toggle('dark',d);
          const sun=btn.querySelector('.theme-sun');
          const moon=btn.querySelector('.theme-moon');
          if(sun)sun.style.display=d?'':'none';
          if(moon)moon.style.display=d?'none':'';
          try{localStorage.setItem(key,d?'dark':'light')}catch(e){}
        };
        try{const s=localStorage.getItem(key);if(s==='dark')setTheme(true)}catch(e){}
        btn.addEventListener('click',()=>setTheme(!document.documentElement.classList.contains('dark')));
      }

      const dc=document.getElementById('clock-docs');
      if(dc){
        const p=n=>String(n).padStart(2,'0');
        const tick=()=>{
          const n=new Date();
          dc.textContent=p(n.getUTCHours())+':'+p(n.getUTCMinutes())+':'+p(n.getUTCSeconds())+' UTC';
        };
        tick(); setInterval(tick,1000);
      }

      const hamburger=document.getElementById('hamburger-docs');
      const mobileNav=document.getElementById('mobile-nav-docs');
      const mobileOverlay=document.getElementById('mobile-overlay-docs');
      const mobileClose=document.getElementById('mobile-nav-close-docs');
      if(hamburger&&mobileNav&&mobileOverlay){
        const open=()=>{
          mobileNav.classList.add('open');
          mobileOverlay.classList.add('open');
          document.body.style.overflow='hidden';
        };
        const close=()=>{
          mobileNav.classList.remove('open');
          mobileOverlay.classList.remove('open');
          document.body.style.overflow='';
        };
        hamburger.addEventListener('click',open);
        if(mobileClose)mobileClose.addEventListener('click',close);
        mobileOverlay.addEventListener('click',close);
        mobileNav.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
      }
    })();
  </script>
</body>
</html>`;
  return c.html(html, 200);
});

// Static asset endpoints
const staticAssets: Record<string, { data: string; mime: string }> = {
  '/favicon.ico':       { data: faviconBase64,   mime: 'image/x-icon' },
  '/favicon-32x32.png': { data: favicon32Base64, mime: 'image/png' },
  '/favicon-16x16.png': { data: favicon16Base64, mime: 'image/png' },
  '/meta-og.png':       { data: metaOgBase64,    mime: 'image/png' },
};
for (const [path, { data, mime }] of Object.entries(staticAssets)) {
  app.get(path, (c) => {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    return c.body(bytes.buffer, 200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
    });
  });
}

// Robots exclusion to prevent crawling in production
app.get('/robots.txt', (c) => {
  return c.text('User-agent: *\nDisallow: /', 200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'public, max-age=86400',
  });
});

// DevTools silent fallback to prevent local 404 log pollution
app.get('/.well-known/appspecific/com.chrome.devtools.json', (c) => {
  return c.json({ error: 'Not Found' }, 404);
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
  const callbackQuery = update.callback_query;

  if (!message && !callbackQuery) {
    return c.text('Ignored non-text payload', 200);
  }

  const userId = message?.from?.id || callbackQuery?.from?.id;
  if (!userId) {
    return c.text('Ignored non-text payload', 200);
  }

  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
  if (!chatId) {
    return c.text('Ignored non-text payload', 200);
  }

  // 2. Distributed Rate Limiting (10 requests / 60 seconds)
  const rateLimitKey = `rl:${userId}`;
  const isLimited = await rateLimiter.isRateLimited(rateLimitKey, 10, 60);

  if (isLimited) {
    Logger.warn(`Rate limiter activated for user ID ${userId}`, { userId });
    try {
      const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
      await client.sendMessage(
        chatId,
        MessageRenderer.rateLimit(),
        'HTML',
      );
    } catch (err) {
      Logger.error('Failed to notify rate limit to user', err);
    }
    return c.text('Rate Limit Active', 200);
  }

  // 3. Process the command/callback asynchronously
  let routePromise: Promise<void>;
  if (callbackQuery) {
    routePromise = router.routeCallbackQuery(
      callbackQuery,
      env,
      serverRegistry,
      providerRegistry,
      c.env as unknown as Record<string, unknown>
    ).catch((err) => {
      Logger.error('Background callback query execution failed', err, {
        userId,
        command: callbackQuery.data,
      });
    });
  } else {
    routePromise = router.route(
      message!,
      env,
      serverRegistry,
      providerRegistry,
      c.env as unknown as Record<string, unknown>
    ).catch((err) => {
      Logger.error('Background command execution failed', err, {
        userId,
        command: message!.text,
      });
    });
  }

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
        const warningMessage = MessageRenderer.warning(
          alias.toUpperCase(),
          `Bandwidth usage has exceeded ${threshold} GB.`,
          {
            'Current Usage': `${totalGB.toFixed(2)} GB`,
            'Threshold': `${threshold} GB`,
          },
        );

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

  let report = MessageRenderer.header('📊 Daily Report');
  report += `${MessageRenderer.line('Date', new Date().toISOString().split('T')[0])}\n`;
  let activeCount = 0;

  for (const server of servers) {
    const data = await kv.get(`metrics:${server.alias.toLowerCase()}`);
    if (!data) {
      report += MessageRenderer.emptyCard(server.alias);
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
      const ageMinutes = (Date.now() - metrics.timestamp * 1000) / (1000 * 60);
      if (ageMinutes <= 15) activeCount++;

      const cpuPct = parseFloat(metrics.cpu) || 0;
      report += MessageRenderer.reportCard(
        server.alias, metrics.timestamp, metrics.cpu, cpuPct,
        metrics.ram.used, metrics.ram.total, metrics.disk.used, metrics.disk.total,
        metrics.uptime, metrics.docker.running, metrics.docker.total,
      );
    } catch {
      report += MessageRenderer.emptyCard(server.alias);
    }
  }

  report += `\n${activeCount} / ${servers.length} servers active.\n`;

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
