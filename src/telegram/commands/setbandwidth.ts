import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

const KV_PREFIX = 'bandwidth_limit:';

export class SetBandwidthHandler implements CommandHandler {
  public readonly name = 'setbandwidth';
  public readonly description = 'Set bandwidth alert threshold per server — override env config. Use "remove" to clear.';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    let alias = ctx.args[0];
    let valueRaw = ctx.args[1];

    // Check if argument came from callback query formatted as "alias:value"
    if (alias && alias.includes(':')) {
      const parts = alias.split(':');
      alias = parts[0];
      valueRaw = parts[1];
    }

    if (!alias) {
      await ctx.reply(
        MessageRenderer.error(this.name, 'missing alias', 'Usage: /setbandwidth &lt;alias&gt; &lt;GB,GB,GB&gt; or /setbandwidth &lt;alias&gt; remove'),
        'HTML',
      );
      return;
    }

    const server = ctx.serverRegistry.getServer(alias);
    if (!server) { await ctx.reply(MessageRenderer.notFound(alias), 'HTML'); return; }

    if (!valueRaw) {
      // Prompt for threshold selection using inline keyboard
      const inlineKeyboard = [
        [
          { text: '50, 80, 100 GB', callback_data: `setbandwidth:${alias}:50,80,100` },
          { text: '100, 200, 500 GB', callback_data: `setbandwidth:${alias}:100,200,500` },
        ],
        [
          { text: 'Remove Thresholds', callback_data: `setbandwidth:${alias}:remove` }
        ]
      ];

      await ctx.reply(
        `<b>Set Bandwidth Alert Thresholds: ${MessageRenderer.raw(alias)}</b>\n\n` +
        `Select a threshold option below, or manually type a command to set custom values (e.g. <code>/setbandwidth ${MessageRenderer.raw(alias)} 20,40,60</code>):`,
        'HTML',
        { inline_keyboard: inlineKeyboard }
      );
      return;
    }

    valueRaw = valueRaw.toLowerCase();
    const key = `${KV_PREFIX}${alias.toLowerCase()}`;

    if (valueRaw === 'remove') {
      await kv.delete(key);
      await ctx.reply(MessageRenderer.success('Bandwidth alert thresholds removed', alias), 'HTML');
      return;
    }

    const thresholds = valueRaw
      .split(',')
      .map((val) => parseFloat(val.trim()))
      .filter((val) => !isNaN(val) && val > 0);

    if (thresholds.length === 0) {
      await ctx.reply(
        MessageRenderer.error(this.name, alias, 'Threshold must be a comma-separated list of positive numbers in GB (e.g. 50,80,100), or "remove".'),
        'HTML',
      );
      return;
    }

    const cleanValue = thresholds.join(',');
    await kv.put(key, cleanValue);

    await ctx.reply(MessageRenderer.success('Bandwidth alert thresholds set', alias, {
      'Thresholds': thresholds.map((t) => `${t} GB`).join(', '),
    }), 'HTML');
  }
}
