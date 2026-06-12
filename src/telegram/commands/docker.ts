import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class DockerHandler implements CommandHandler {
  public readonly name = 'docker';
  public readonly description = 'Lists active Docker containers and their states on VPS';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV as {
      get(key: string): Promise<string | null>;
    } | null;

    if (!kv) {
      await ctx.reply('⚠️ <b>Error:</b> MONITORING_KV binding is not configured.', 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '🐳 <b>Docker Containers Telemetry Status</b>\n\n';

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += `🔹 <b>${alias}</b>: <i>No telemetry recorded</i>\n\n`;
        continue;
      }

      try {
        interface ContainerInfo {
          name: string;
          status: string;
          state: string;
        }
        interface MetricsPayload {
          docker?: {
            running: number;
            total: number;
            unhealthy: number;
            containers?: ContainerInfo[];
          };
        }
        const metrics = JSON.parse(data) as MetricsPayload;
        const docker = metrics.docker;

        if (!docker) {
          report += `🔹 <b>${alias}</b>: <i>Docker details unavailable</i>\n\n`;
          continue;
        }

        const unhealthyText = docker.unhealthy > 0 ? ` (⚠️ ${docker.unhealthy} unhealthy)` : '';
        report += `🖥️ <b>${alias}</b> [${docker.running}/${docker.total} running]${unhealthyText}\n`;

        const containers = docker.containers || [];
        if (containers.length === 0) {
          report += '  <i>No containers running.</i>\n\n';
          continue;
        }

        for (const c of containers) {
          const stateEmoji = c.state === 'running' ? '🟢' : '🔴';
          report += `  ${stateEmoji} <code>${c.name}</code> - <i>${c.status}</i>\n`;
        }
        report += '\n';
      } catch {
        report += `🔹 <b>${alias}</b>: <i>Corrupted data</i>\n\n`;
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
