import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class UptimeHandler implements CommandHandler {
  public readonly name = 'uptime';
  public readonly description = 'System uptime and telemetry freshness per server';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    let aliases = ctx.serverRegistry.getAliases();
    if (ctx.args.length >= 1) {
      const alias = ctx.args[0];
      const server = ctx.serverRegistry.getServer(alias);
      if (!server) {
        await ctx.reply(MessageRenderer.notFound(alias), 'HTML');
        return;
      }
      aliases = [alias];
    }
    const cards: string[] = [];

    const raws = await Promise.all(
      aliases.map((alias) => kv.get(`metrics:${alias.toLowerCase()}`)),
    );

    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i];
      const raw = raws[i];
      if (!raw) { cards.push(MessageRenderer.emptyCard(alias)); continue; }

      try {
        interface M {
          timestamp: number;
          uptime: number;
          cpu: string;
          ram?: { total: number; used: number };
          disk?: { total: number; used: number };
          docker?: { running: number; total: number; unhealthy: number };
        }
        const m = JSON.parse(raw) as M;

        const cpuPct = parseFloat(m.cpu) || 0;
        const ramPct = m.ram ? (m.ram.used / m.ram.total) * 100 : 0;
        const diskPct = m.disk ? (m.disk.used / m.disk.total) * 100 : 0;
        const ageMin = Math.max(0, (Date.now() - m.timestamp * 1000) / 60000);

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
        if (m.docker && m.docker.total > 0) {
          if (m.docker.unhealthy > 0) dockerHealth = 'Warning';
          if (m.docker.running < m.docker.total) dockerHealth = 'Critical';
        }

        const healthList = [cpuHealth, ramHealth, diskHealth, freshnessHealth];
        if (m.docker && m.docker.total > 0) healthList.push(dockerHealth);

        let overallHealth = 'Healthy';
        if (healthList.includes('Critical')) {
          overallHealth = 'Critical';
        } else if (healthList.includes('Warning')) {
          overallHealth = 'Warning';
        }

        const reasons: string[] = [];
        if (!['Healthy', 'Healthy', 'Healthy'].includes(cpuHealth)) reasons.push(`CPU ${cpuHealth.toLowerCase()}`);
        if (!['Healthy', 'Healthy', 'Healthy'].includes(ramHealth)) reasons.push(`RAM ${ramHealth.toLowerCase()}`);
        if (!['Healthy', 'Healthy', 'Healthy'].includes(diskHealth)) reasons.push(`Disk ${diskHealth.toLowerCase()}`);
        if (freshnessHealth !== 'Healthy') reasons.push(freshnessHealth === 'Critical' ? 'agent offline' : 'agent delayed');
        if (m.docker && m.docker.total > 0) {
          if (m.docker.running < m.docker.total) reasons.push(`${m.docker.total - m.docker.running} stopped svc`);
          if (m.docker.unhealthy > 0) reasons.push(`${m.docker.unhealthy} unhealthy svc`);
        }
        const reasonText = reasons.length > 0 ? reasons.join(', ') : 'None';

        cards.push(MessageRenderer.uptimeCard(alias, m.timestamp, m.uptime, overallHealth, reasonText));
      } catch {
        cards.push(MessageRenderer.emptyCard(alias));
      }
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
