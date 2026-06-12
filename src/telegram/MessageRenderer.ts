function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class MessageRenderer {
  // ── Utilities ────────────────────────────────────────────
  static bar(pct: number, w = 10): string {
    const fill = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w);
    return '█'.repeat(fill) + '░'.repeat(w - fill);
  }

  static healthIcon(pct: number): string {
    if (pct >= 90) return '🔴';
    if (pct >= 70) return '🟡';
    return '🟢';
  }

  static duration(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  static ago(ts: number): string {
    const diff = Math.floor((Date.now() - ts * 1000) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  static header(text: string): string {
    return `<b>${escapeHtml(text)}</b>\n`;
  }

  static line(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b> <code>${escapeHtml(value)}</code>\n`;
  }

  static raw(text: string): string {
    return escapeHtml(text);
  }

  // ── Monitoring Commands ──────────────────────────────────

  /** Full server telemetry card */
  static reportCard(alias: string, ts: number, cpu: string, cpuPct: number,
    ramUsed: number, ramTotal: number, diskUsed: number, diskTotal: number,
    uptime: number, dockerRunning?: number, dockerTotal?: number, dockerUnhealthy?: number,
  ): string {
    const ramPct = (ramUsed / ramTotal) * 100;
    const diskPct = (diskUsed / diskTotal) * 100;
    const usedG = (v: number) => (v / 1024).toFixed(1);

    const mainHealth = this.healthIcon(Math.max(cpuPct, ramPct, diskPct));
    let msg = `🖥️ <b>${escapeHtml(alias)}</b>  ${mainHealth}  <i>(${this.ago(ts)})</i>\n`;
    msg += `• <b>CPU:</b> <code>${cpu}%</code>\n`;
    msg += `• <b>Memory:</b> <code>${usedG(ramUsed)}/${usedG(ramTotal)} GB (${ramPct.toFixed(1)}%)</code>\n`;
    msg += `• <b>Disk:</b> <code>${usedG(diskUsed)}/${usedG(diskTotal)} GB (${diskPct.toFixed(1)}%)</code>\n`;
    msg += `• <b>Uptime:</b> <code>${this.duration(uptime)}</code>\n`;

    if (dockerTotal !== undefined) {
      const unhealthyPart = dockerUnhealthy && dockerUnhealthy > 0 ? ` (${dockerUnhealthy} unhealthy)` : '';
      msg += `• <b>Docker:</b> <code>${dockerRunning ?? 0}/${dockerTotal} running${unhealthyPart}</code>\n`;
    }
    return msg;
  }

  /** Compact uptime card */
  static uptimeCard(alias: string, ts: number, uptime: number, cpu: string): string {
    const ageMin = Math.floor((Date.now() - ts * 1000) / 60000);
    let statusIcon = '🟢';
    if (ageMin > 60) statusIcon = '🔴';
    else if (ageMin > 15) statusIcon = '🟡';

    let msg = `${statusIcon} <b>${escapeHtml(alias)}</b>  <i>(${this.ago(ts)})</i>\n`;
    msg += `• <b>Uptime:</b> <code>${this.duration(uptime)}</code>\n`;
    msg += `• <b>CPU:</b> <code>${cpu}%</code>\n`;
    return msg;
  }

  /** Bandwidth card */
  static bandwidthCard(alias: string, ts: number, rx: number, tx: number): string {
    const totalGB = (rx + tx) / (1024 ** 3);
    const rxGB = (rx / (1024 ** 3)).toFixed(2);
    const txGB = (tx / (1024 ** 3)).toFixed(2);

    let msg = `📊 <b>${escapeHtml(alias)}</b>  <i>(${this.ago(ts)})</i>\n`;
    msg += `• <b>Total:</b> <code>${totalGB.toFixed(2)} GB</code>\n`;
    msg += `• <b>Download (RX):</b> <code>${rxGB} GB</code>\n`;
    msg += `• <b>Upload (TX):</b> <code>${txGB} GB</code>\n`;
    return msg;
  }

  /** Docker containers card */
  static dockerCard(alias: string, running: number, total: number, unhealthy: number,
    containers: Array<{ name: string; status: string; state: string }>,
  ): string {
    const icon = unhealthy > 0 ? '🟡' : '🟢';
    const unhealthyPart = unhealthy > 0 ? ` (${unhealthy} unhealthy)` : '';

    let msg = `🐳 <b>${escapeHtml(alias)}</b>  ${icon}  <code>${running}/${total} running${unhealthyPart}</code>\n`;

    if (containers.length > 0) {
      for (const c of containers) {
        const stateIcon = c.state === 'running' ? '🟢' : c.state === 'exited' ? '🔴' : '🟡';
        msg += `• ${stateIcon} <code>${escapeHtml(c.name)}</code> (${escapeHtml(c.state)} - ${escapeHtml(c.status)})\n`;
      }
    }
    return msg;
  }

  /** Container detail row for docker output */
  static containerRow(name: string, state: string, status: string): string {
    const icon = state === 'running' ? '🟢' : state === 'exited' ? '🔴' : '🟡';
    return `${icon} <code>${escapeHtml(name)}</code> (${escapeHtml(state)} - ${escapeHtml(status)})`;
  }

  /** Compact empty/no-data placeholder */
  static emptyCard(alias: string): string {
    let msg = `⚠️ <b>${escapeHtml(alias)}</b>\n`;
    msg += `• <b>Status:</b> No data available\n`;
    return msg;
  }

  /** No data summary card */
  static noDataCard(alias: string): string {
    return `⚠️ <b>${escapeHtml(alias)}</b>  <i>(No data)</i>\n`;
  }

  /** /health dashboard */
  static healthDashboard(kvStatus: string, providers: string, region: string,
    env: string, users: number,
  ): string {
    const icon = kvStatus === 'Bound' ? '🟢' : '🟡';
    let msg = `⚙️ <b>Control Plane</b>\n`;
    msg += `• <b>Status:</b> <code>${kvStatus}</code> ${icon}\n`;
    msg += `• <b>Providers:</b> <code>${providers || 'None'}</code>\n`;
    msg += `• <b>Region:</b> <code>${region}</code>\n`;
    msg += `• <b>Environment:</b> <code>${env}</code>\n`;
    msg += `• <b>Users:</b> <code>${users} authorized</code>\n`;
    msg += `• <b>Runtime:</b> <code>Cloudflare Workers</code>\n`;
    return msg;
  }

  // ── Existing methods (unchanged) ─────────────────────────

  static success(action: string, target: string, extra?: Record<string, string>): string {
    let msg = this.header('✅ Operation Completed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    if (extra) {
      msg += '\n';
      for (const [k, v] of Object.entries(extra)) {
        msg += this.line(k, v);
      }
    }
    return msg;
  }

  static status(fields: Record<string, string>): string {
    let msg = this.header('Server Status');
    msg += '\n';
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static monitoringReport(date: string, fields: Record<string, string>): string {
    let msg = this.header('📊 Daily Report');
    msg += `\n${this.line('Date', date)}\n`;
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static error(action: string, target: string, reason: string, reference?: string): string {
    let msg = this.header('❌ Operation Failed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    msg += `\n<b>Reason:</b>\n<code>${escapeHtml(reason)}</code>\n`;
    if (reference) {
      msg += this.line('Reference', reference);
    }
    return msg;
  }

  static generalError(reason: string): string {
    let msg = this.header('❌ Error');
    msg += `\n<code>${escapeHtml(reason)}</code>`;
    return msg;
  }

  static commandOutput(lines: string[]): string {
    return lines.map((l) => escapeHtml(l)).join('\n');
  }

  static warning(title: string, reason: string, extra?: Record<string, string>): string {
    let msg = this.header('⚠️ Warning');
    msg += `\n${this.line('Subject', title)}`;
    msg += `<b>Details:</b>\n<code>${escapeHtml(reason)}</code>\n`;
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        msg += this.line(k, v);
      }
    }
    return msg;
  }

  static serverMetrics(alias: string, fields: Record<string, string>): string {
    let msg = this.header(`Metrics: ${alias}`);
    msg += '\n';
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static multiline(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b>\n<code>${escapeHtml(value)}</code>\n`;
  }

  static help(commands: Array<{ command: string; description: string; args?: string }>): string {
    let msg = this.header('🚀 Infra-Bot');
    msg += `\n<code>Commands</code>\n`;
    for (const c of commands) {
      const cmdLine = c.args ? `${c.command} ${c.args}` : c.command;
      msg += `\n<code>${escapeHtml(cmdLine)}</code>  ${escapeHtml(c.description)}`;
    }
    return msg;
  }

  static notFound(alias: string): string {
    return this.generalError(`Server "${alias}" not found in registry.`);
  }

  static rateLimit(): string {
    let msg = this.header('⏳ Rate Limit');
    msg += `\nMaximum 10 commands per minute. Please wait.`;
    return msg;
  }

  static unknownCommand(command: string): string {
    let msg = this.header('Unknown Command');
    msg += `\n${this.line('Command', command)}`;
    msg += `Use /help to view available commands.`;
    return msg;
  }

  static configError(binding: string): string {
    let msg = this.header('Config Error');
    msg += `\n${this.line('Binding', binding)}`;
    msg += `Required KV binding is not configured. See /docs.`;
    return msg;
  }

  static noServers(): string {
    return this.generalError('No servers configured in registry.');
  }

  static providerStatus(alias: string, status: string, ip: string, id: string, region: string): string {
    let msg = this.header(`Server: ${alias}`);
    msg += '\n';
    msg += this.line('Status', status);
    msg += this.line('IP', ip || 'N/A');
    msg += this.line('ID', id);
    msg += this.line('Region', region);
    return msg;
  }

  static serverDetails(alias: string, provider: string, fields: Record<string, string>): string {
    let msg = this.header(`Server: ${alias}`);
    msg += `\n${this.line('Provider', provider)}`;
    for (const [k, v] of Object.entries(fields)) {
      msg += this.line(k, v);
    }
    return msg;
  }

  static operationStatus(action: string, target: string, provider: string, status: string): string {
    let msg = this.header('✅ Operation Completed');
    msg += `\n${this.line('Action', action)}`;
    msg += this.line('Target', target);
    msg += this.line('Provider', provider);
    msg += this.line('Status', status);
    return msg;
  }

  static warningAlert(alias: string, metric: string, current: string, threshold: string): string {
    let msg = this.header('⚠️ Alert');
    msg += `\n${this.line('Server', alias)}`;
    msg += this.line('Metric', metric);
    msg += this.line('Current', current);
    msg += this.line('Threshold', threshold);
    return msg;
  }
}
