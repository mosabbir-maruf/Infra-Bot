const RESERVED_RE = /[_*[\]()~`>#+\-=|{}.!]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(RESERVED_RE, '\\$&');
}
