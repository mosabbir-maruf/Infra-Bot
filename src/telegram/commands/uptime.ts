import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class UptimeHandler implements CommandHandler {
  public readonly name = 'uptime';
  public readonly description = 'System uptime and telemetry freshness per server';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const aliases = ctx.serverRegistry.getAliases();
    const cards: string[] = [];

    for (const alias of aliases) {
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
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

        const getHealthState = (val: number, thresholds: { warn: number; crit: number }) => {
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

        cards.push(MessageRenderer.uptimeCard(alias, m.timestamp, m.uptime, overallHealth));
      } catch {
        cards.push(MessageRenderer.emptyCard(alias));
      }
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
