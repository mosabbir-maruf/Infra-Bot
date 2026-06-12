import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class DockerHandler implements CommandHandler {
  public readonly name = 'docker';
  public readonly description = 'Lists active Docker containers and their states on VPS';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV as {
      get(key: string): Promise<string | null>;
    } | null;

    if (!kv) {
      await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '';

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += MessageRenderer.serverMetrics(alias, {
          'Status': 'No telemetry data',
        });
        report += '\n';
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
          report += MessageRenderer.serverMetrics(alias, {
            'Status': 'Docker metrics unavailable',
          });
          report += '\n';
          continue;
        }

        const unhealthy = docker.unhealthy > 0 ? ` (${docker.unhealthy} unhealthy)` : '';
        report += MessageRenderer.serverMetrics(alias, {
          'Containers': `${docker.running}/${docker.total} running${unhealthy}`,
        });

        const containers = docker.containers || [];
        if (containers.length > 0) {
          for (const c of containers) {
            report += MessageRenderer.line(`  ${c.name}`, c.status);
          }
        }

        report += '\n';
      } catch {
        report += MessageRenderer.serverMetrics(alias, {
          'Status': 'Corrupted telemetry data',
        });
        report += '\n';
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
