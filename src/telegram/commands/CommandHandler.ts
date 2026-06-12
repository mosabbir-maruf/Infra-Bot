import { TelegramContext } from '../../types';

export interface CommandHandler {
  readonly name: string;
  readonly description: string;
  execute(ctx: TelegramContext): Promise<void>;
}
