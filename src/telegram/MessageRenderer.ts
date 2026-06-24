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

  private static formatDateTime(ts: number, offsetHours: number): string {
    const d = new Date(ts * 1000 + offsetHours * 3600 * 1000);
    const yr = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    
    let hours = d.getUTCHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const hr = String(hours).padStart(2, '0');

    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const sec = String(d.getUTCSeconds()).padStart(2, '0');
    return `${dy}-${mo}-${yr} ${hr}:${min}:${sec} ${ampm}`;
  }

  static formatUTC(ts: number): string {
    return this.formatDateTime(ts, 0);
  }

  static formatBD(ts: number): string {
    return this.formatDateTime(ts, 6);
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
  static reportCard(alias: string, ts: number, _cpu: string, cpuPct: number,
    ramUsed: number, ramTotal: number, diskUsed: number, diskTotal: number,
    uptime: number, dockerRunning?: number, dockerTotal?: number, dockerUnhealthy?: number,
  ): string {
    const ramPct = (ramUsed / ramTotal) * 100;
    const diskPct = (diskUsed / diskTotal) * 100;
    const ageMin = Math.max(0, (Date.now() - ts * 1000) / 60000);

    const getHealthState = (val: number, thresholds: { warn: number; crit: number }): string => {
      if (val >= thresholds.crit) return 'Critical';
      if (val >= thresholds.warn) return 'Warning';
      return 'Healthy';
    };

    const cpuHealth = getHealthState(cpuPct, { warn: 70, crit: 90 });
    const ramHealth = getHealthState(ramPct, { warn: 75, crit: 90 });
    const diskHealth = getHealthState(diskPct, { warn: 80, crit: 95 });

    let freshnessHealth: 'Healthy' | 'Warning' | 'Critical' = 'Healthy';
    if (ageMin > 30) freshnessHealth = 'Critical';
    else if (ageMin > 10) freshnessHealth = 'Warning';

    let dockerHealth: 'Healthy' | 'Warning' | 'Critical' = 'Healthy';
    if (dockerTotal !== undefined && dockerTotal > 0) {
      if (dockerUnhealthy && dockerUnhealthy > 0) dockerHealth = 'Warning';
      if (dockerRunning !== undefined && dockerRunning < dockerTotal) dockerHealth = 'Critical';
    }

    const healthList = [cpuHealth, ramHealth, diskHealth, freshnessHealth];
    if (dockerTotal !== undefined && dockerTotal > 0) healthList.push(dockerHealth);

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (healthList.includes('Critical')) {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (healthList.includes('Warning')) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    const reasons: string[] = [];
    if (cpuHealth !== 'Healthy') reasons.push(`CPU ${cpuHealth.toLowerCase()}`);
    if (ramHealth !== 'Healthy') reasons.push(`RAM ${ramHealth.toLowerCase()}`);
    if (diskHealth !== 'Healthy') reasons.push(`Disk ${diskHealth.toLowerCase()}`);
    if (freshnessHealth !== 'Healthy') {
      reasons.push(freshnessHealth === 'Critical' ? 'agent offline' : 'agent delayed');
    }
    if (dockerTotal !== undefined && dockerTotal > 0) {
      if (dockerRunning !== undefined && dockerRunning < dockerTotal) {
        reasons.push(`${dockerTotal - dockerRunning} stopped svc`);
      }
      if (dockerUnhealthy && dockerUnhealthy > 0) {
        reasons.push(`${dockerUnhealthy} unhealthy svc`);
      }
    }
    const reasonText = reasons.length > 0 ? reasons.join(', ') : 'None';

    let msg = '<b>Infrastructure Report</b>\n';
    msg += `<code>┌ Server   </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Health   </code> <code>${overallHealth} ${healthEmoji}</code>\n`;
    msg += `<code>└ Reason   </code> <code>${escapeHtml(reasonText)}</code>\n\n`;

    msg += '<b>Resources</b>\n';
    msg += `<code>├ CPU      </code> <code>[${this.bar(cpuPct)}] ${cpuPct.toFixed(0)}%</code>\n`;
    msg += `<code>├ Memory   </code> <code>[${this.bar(ramPct)}] ${ramPct.toFixed(0)}%</code>\n`;
    msg += `<code>└ Disk     </code> <code>[${this.bar(diskPct)}] ${diskPct.toFixed(0)}%</code>\n`;

    if (dockerTotal !== undefined) {
      const runningCount = dockerRunning ?? 0;
      const unhealthyCount = dockerUnhealthy ?? 0;
      msg += '\n<b>Containers</b>\n';
      msg += `<code>├ Running  </code> <code>${runningCount}/${dockerTotal}</code>\n`;
      msg += `<code>└ Status   </code> <code>${unhealthyCount > 0 ? `${unhealthyCount} Unhealthy 🔴` : 'Healthy 🟢'}</code>\n`;
    }

    msg += `\n<code>┌ Uptime   </code> <code>${this.duration(uptime)}</code>\n`;
    msg += `<code>├ Time     </code> <code>${this.ago(ts)}</code>\n`;
    msg += `<code>├ ├ UTC    </code> <code>${this.formatUTC(ts)}</code>\n`;
    msg += `<code>└ └ BD     </code> <code>${this.formatBD(ts)}</code>`;
    return msg;
  }

  /** Compact uptime card */
  static uptimeCard(alias: string, ts: number, uptime: number, health: string): string {
    let healthEmoji = '🟢';
    if (health === 'Critical') healthEmoji = '🔴';
    else if (health === 'Warning') healthEmoji = '🟡';

    let msg = '<b>System Uptime</b>\n';
    msg += `<code>┌ Server   </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Uptime   </code> <code>${this.duration(uptime)}</code>\n`;
    msg += `<code>├ Health   </code> <code>${health} ${healthEmoji}</code>\n`;
    msg += `<code>├ Time     </code> <code>${this.ago(ts)}</code>\n`;
    msg += `<code>├ ├ UTC    </code> <code>${this.formatUTC(ts)}</code>\n`;
    msg += `<code>└ └ BD     </code> <code>${this.formatBD(ts)}</code>`;
    return msg;
  }

  /** Bandwidth card */
  static bandwidthCard(alias: string, ts: number, rx: number, tx: number, limitGB?: number): string {
    const totalGB = (rx + tx) / (1024 ** 3);
    const rxGB = (rx / (1024 ** 3)).toFixed(2);
    const txGB = (tx / (1024 ** 3)).toFixed(2);

    let msg = '<b>Bandwidth Usage</b>\n';
    msg += `<code>┌ Server   </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Download </code> <code>${rxGB} GB</code>\n`;
    msg += `<code>├ Upload   </code> <code>${txGB} GB</code>\n`;
    msg += `<code>└ Total    </code> <code>${totalGB.toFixed(2)} GB</code>\n`;

    if (limitGB && limitGB > 0) {
      const usagePct = Math.round((totalGB / limitGB) * 100);
      msg += '\n<b>Quota Limit</b>\n';
      msg += `<code>└ Usage    </code> <code>[${this.bar(usagePct)}] ${usagePct}% / ${limitGB} GB</code>\n`;
    }

    msg += `\n<code>┌ Time     </code> <code>${this.ago(ts)}</code>\n`;
    msg += `<code>├ ├ UTC    </code> <code>${this.formatUTC(ts)}</code>\n`;
    msg += `<code>└ └ BD     </code> <code>${this.formatBD(ts)}</code>`;
    return msg;
  }

  /** Docker containers card */
  static dockerCard(alias: string, running: number, total: number, unhealthy: number,
    containers: Array<{ name: string; status: string; state: string }>, ts: number
  ): string {
    const healthy = running - unhealthy;
    const issues = total - running + unhealthy;

    let msg = '<b>Container Status</b>\n';
    msg += `<code>┌ Server   </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Running  </code> <code>${running}/${total}</code>\n`;
    msg += `<code>├ Healthy  </code> <code>${healthy}</code>\n`;
    msg += `<code>└ Issues   </code> <code>${issues} ${issues > 0 ? '🔴' : '🟢'}</code>\n`;

    const affectedContainers = containers.filter(c => {
      const isRunning = c.state.toLowerCase() === 'running';
      const isUnhealthy = c.status.toLowerCase().includes('unhealthy');
      return !isRunning || isUnhealthy;
    });

    if (affectedContainers.length > 0) {
      msg += '\n<b>Affected Services</b>\n';
      for (let i = 0; i < affectedContainers.length; i++) {
        const c = affectedContainers[i];
        const isRunning = c.state.toLowerCase() === 'running';
        const isUnhealthy = c.status.toLowerCase().includes('unhealthy');

        const stateText = isRunning ? 'Running' : 'Stopped';
        let healthText = 'Healthy';
        let healthEmoji = '🟢';
        if (!isRunning) {
          healthText = 'Critical';
          healthEmoji = '🔴';
        } else if (isUnhealthy) {
          healthText = 'Unhealthy';
          healthEmoji = '🔴';
        }

        const isLast = i === affectedContainers.length - 1;
        const prefixSymbol = isLast ? '└' : '├';

        msg += `<code>${prefixSymbol} </code> <code>${escapeHtml(c.name)} (${stateText} · ${healthText} ${healthEmoji})</code>\n`;
      }
    }

    msg += `\n<code>┌ Time     </code> <code>${this.ago(ts)}</code>\n`;
    msg += `<code>├ ├ UTC    </code> <code>${this.formatUTC(ts)}</code>\n`;
    msg += `<code>└ └ BD     </code> <code>${this.formatBD(ts)}</code>`;
    return msg;
  }

  /** Compact empty/no-data placeholder */

  static emptyCard(alias: string): string {
    let msg = '<b>Infrastructure Report</b>\n';
    msg += `<code>┌ Server   </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += '<code>├ Status   </code> <code>Offline 🔴</code>\n';
    msg += '<code>├ Health   </code> <code>Critical 🔴</code>\n';
    msg += '<code>├ Time     </code> <code>Never</code>\n';
    msg += '<code>├ ├ UTC    </code> <code>N/A</code>\n';
    msg += '<code>└ └ BD     </code> <code>N/A</code>';
    return msg;
  }

  /** /health dashboard */

  static healthDashboard(kvStatus: string, providers: string, _region: string,
    _env: string, users: number, ts: number
  ): string {
    const isOperational = kvStatus === 'Bound';
    const statusText = isOperational ? 'Operational' : 'Degraded';
    const statusEmoji = isOperational ? '🟢' : '🔴';

    let msg = '<b>Control Plane Health</b>\n';
    msg += `<code>┌ Status     </code> <code>${statusText} ${statusEmoji}</code>\n`;
    msg += `<code>├ Providers  </code> <code>${providers}</code>\n`;
    msg += `<code>├ Telemetry  </code> <code>${isOperational ? 'Connected 🟢' : 'Disconnected 🔴'}</code>\n`;
    msg += '<code>├ Runtime    </code> <code>Cloudflare Workers</code>\n';
    msg += `<code>├ Auth Users </code> <code>${users}</code>\n`;
    if (ts > 0) {
      msg += `<code>├ Time       </code> <code>${this.ago(ts)}</code>\n`;
      msg += `<code>├ ├ UTC      </code> <code>${this.formatUTC(ts)}</code>\n`;
      msg += `<code>└ └ BD       </code> <code>${this.formatBD(ts)}</code>`;
    } else {
      msg += '<code>└ Time       </code> <code>Never</code>';
    }
    return msg;
  }

  // ── Existing methods (redesigned) ─────────────────────────

  static success(action: string, target: string, extra?: Record<string, string>): string {
    let msg = '<b>✅ Operation Completed</b>\n';
    msg += `<code>┌ Action     </code> <code>${escapeHtml(action)}</code>\n`;
    msg += `<code>└ Target     </code> <code>${escapeHtml(target)}</code>\n`;
    if (extra && Object.keys(extra).length > 0) {
      msg += '\n<b>Details</b>\n';
      const entries = Object.entries(extra);
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i];
        const prefix = i === entries.length - 1 ? '└' : '├';
        msg += `<code>${prefix} ${escapeHtml(k.padEnd(10, ' '))} </code> <code>${escapeHtml(v)}</code>\n`;
      }
    }
    return msg;
  }

  static status(fields: Record<string, string>): string {
    let msg = '<b>Server Status</b>\n';
    const entries = Object.entries(fields);
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const prefix = i === entries.length - 1 ? '└' : '├';
      msg += `<code>${prefix} ${escapeHtml(k.padEnd(10, ' '))} </code> <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static monitoringReport(date: string, fields: Record<string, string>): string {
    let msg = '<b>📊 Daily Report</b>\n';
    msg += `<code>┌ Date       </code> <code>${escapeHtml(date)}</code>\n\n`;
    const entries = Object.entries(fields);
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const prefix = i === entries.length - 1 ? '└' : '├';
      msg += `<code>${prefix} ${escapeHtml(k.padEnd(10, ' '))} </code> <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static error(action: string, target: string, reason: string, reference?: string): string {
    let cleanReason = reason;
    if (reason.toLowerCase().includes('error:') || reason.toLowerCase().includes('exception:') || reason.includes('at ')) {
      cleanReason = 'An internal system error occurred.';
    }

    let msg = '<b>❌ Operation Failed</b>\n';
    msg += `<code>┌ Action     </code> <code>${escapeHtml(action)}</code>\n`;
    msg += `<code>├ Target     </code> <code>${escapeHtml(target)}</code>\n`;
    msg += `<code>└ Reason     </code> <code>${escapeHtml(cleanReason)}</code>`;

    if (reference) {
      msg += `\n\n<b>Usage</b>\n<code>${escapeHtml(reference)}</code>`;
    }
    return msg;
  }

  static generalError(reason: string): string {
    let cleanReason = reason;
    if (reason.toLowerCase().includes('error:') || reason.toLowerCase().includes('exception:') || reason.includes('at ')) {
      cleanReason = 'An internal system error occurred.';
    }
    let msg = '<b>❌ Operation Failed</b>\n';
    msg += `<code>└ Reason     ${escapeHtml(cleanReason)}</code>`;
    return msg;
  }

  static commandOutput(lines: string[]): string {
    return lines.map((l) => escapeHtml(l)).join('\n');
  }

  static warning(title: string, reason: string, extra?: Record<string, string>): string {
    let msg = '<b>⚠️ Warning</b>\n';
    msg += `<code>┌ Subject    </code> <code>${escapeHtml(title)}</code>\n`;
    msg += `<code>└ Details    </code> <code>${escapeHtml(reason)}</code>\n`;
    if (extra && Object.keys(extra).length > 0) {
      msg += '\n<b>Metadata</b>\n';
      const entries = Object.entries(extra);
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i];
        const prefix = i === entries.length - 1 ? '└' : '├';
        msg += `<code>${prefix} ${escapeHtml(k.padEnd(10, ' '))} </code> <code>${escapeHtml(v)}</code>\n`;
      }
    }
    return msg;
  }

  static help(commands: Array<{ command: string; description: string; args?: string }>): string {
    let msg = '<b>🚀 Infra-Bot Control Console</b>\n\n';
    msg += '<b>Commands</b>\n';
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      const cmdLine = c.args ? `${c.command} ${c.args}` : c.command;
      const isLast = i === commands.length - 1;
      const prefix = isLast ? '└' : '├';
      msg += `<code>${prefix} ${escapeHtml(cmdLine.padEnd(20, ' '))}</code> · ${escapeHtml(c.description)}\n`;
    }
    return msg;
  }

  static notFound(alias: string): string {
    return this.generalError(`Server "${alias}" not found in registry.`);
  }

  static rateLimit(): string {
    let msg = '<b>⏳ Rate Limit</b>\n';
    msg += '<code>└ Message    10 commands/min limit. Please wait.</code>';
    return msg;
  }

  static unknownCommand(command: string): string {
    let msg = '<b>❌ Unknown Command</b>\n';
    msg += `<code>┌ Command    ${escapeHtml(command)}</code>\n`;
    msg += '<code>└ Help       Use /help to view available commands.</code>';
    return msg;
  }

  static configError(binding: string): string {
    let msg = '<b>❌ Config Error</b>\n';
    msg += `<code>┌ Binding    ${escapeHtml(binding)}</code>\n`;
    msg += '<code>└ Help       Required KV namespace unbound. See /docs.</code>';
    return msg;
  }

  static noServers(): string {
    return this.generalError('No servers configured in registry.');
  }

  static providerStatus(alias: string, status: string, ip: string, id: string, region: string, errorMsg?: string): string {
    const isRunning = status.toLowerCase() === 'running';
    const isError = status.toLowerCase() === 'error';

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (isError) {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (!isRunning) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    let msg = '<b>Infrastructure Status Report</b>\n';
    msg += `<code>┌ Server     </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Status     </code> <code>${escapeHtml(status)}</code>\n`;
    msg += `<code>├ Health     </code> <code>${overallHealth} ${healthEmoji}</code>\n`;
    msg += `<code>├ IP Address </code> <code>${escapeHtml(ip)}</code>\n`;
    msg += `<code>├ InstanceID </code> <code>${escapeHtml(id)}</code>\n`;
    msg += `<code>└ Region     </code> <code>${escapeHtml(region)}</code>`;

    if (isError && errorMsg) {
      msg += `\n\n<b>Operational Status</b>\n<code>${escapeHtml(errorMsg)}</code>`;
    }
    return msg;
  }

  static serverDetails(alias: string, provider: string, fields: Record<string, string>): string {
    const statusVal = fields['Status'] || 'Unknown';
    const isRunning = statusVal.toLowerCase() === 'running';

    let overallHealth = 'Healthy';
    let healthEmoji = '🟢';
    if (statusVal.toLowerCase() === 'error' || statusVal.toLowerCase() === 'stopped') {
      overallHealth = 'Critical';
      healthEmoji = '🔴';
    } else if (!isRunning) {
      overallHealth = 'Warning';
      healthEmoji = '🟡';
    }

    let msg = '<b>Server Details</b>\n';
    msg += `<code>┌ Server     </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Provider   </code> <code>${escapeHtml(provider)}</code>\n`;
    msg += `<code>├ Status     </code> <code>${escapeHtml(statusVal)}</code>\n`;
    msg += `<code>├ Health     </code> <code>${overallHealth} ${healthEmoji}</code>\n`;

    const entries = Object.entries(fields).filter(([k]) => k !== 'Status');
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const isLast = i === entries.length - 1;
      const prefix = isLast ? '└' : '├';
      msg += `<code>${prefix} ${escapeHtml(k.padEnd(10, ' '))} </code> <code>${escapeHtml(v)}</code>\n`;
    }
    return msg;
  }

  static operationStatus(action: string, target: string, provider: string, status: string): string {
    let msg = '<b>✅ Operation Completed</b>\n';
    msg += `<code>┌ Action     </code> <code>${escapeHtml(action)}</code>\n`;
    msg += `<code>├ Target     </code> <code>${escapeHtml(target)}</code>\n`;
    msg += `<code>├ Provider   </code> <code>${escapeHtml(provider)}</code>\n`;
    msg += `<code>└ Status     </code> <code>${escapeHtml(status)}</code>\n`;
    return msg;
  }

  static warningAlert(alias: string, metric: string, current: string, threshold: string): string {
    let msg = '<b>⚠️ Alert</b>\n';
    msg += `<code>┌ Server     </code> <code>${escapeHtml(alias)}</code>\n`;
    msg += `<code>├ Metric     </code> <code>${escapeHtml(metric)}</code>\n`;
    msg += `<code>├ Current    </code> <code>${escapeHtml(current)}</code>\n`;
    msg += `<code>└ Threshold  </code> <code>${escapeHtml(threshold)}</code>\n`;
    return msg;
  }
}
