import { describe, it, expect } from 'vitest';
import { escapeMarkdownV2 } from '../src/telegram/Escaper';

describe('escapeMarkdownV2', () => {
  it('escapes hyphens', () => {
    expect(escapeMarkdownV2('server-01')).toBe('server\\-01');
  });

  it('escapes underscores', () => {
    expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world');
  });

  it('escapes parentheses', () => {
    expect(escapeMarkdownV2('(group)')).toBe('\\(group\\)');
  });

  it('escapes asterisks', () => {
    expect(escapeMarkdownV2('bold*text')).toBe('bold\\*text');
  });

  it('escapes square brackets', () => {
    expect(escapeMarkdownV2('[link]')).toBe('\\[link\\]');
  });

  it('escapes tildes', () => {
    expect(escapeMarkdownV2('~text~')).toBe('\\~text\\~');
  });

  it('escapes backticks', () => {
    expect(escapeMarkdownV2('`code`')).toBe('\\`code\\`');
  });

  it('escapes greater-than', () => {
    expect(escapeMarkdownV2('a > b')).toBe('a \\> b');
  });

  it('escapes hash', () => {
    expect(escapeMarkdownV2('#tag')).toBe('\\#tag');
  });

  it('escapes plus', () => {
    expect(escapeMarkdownV2('a+b')).toBe('a\\+b');
  });

  it('escapes equals', () => {
    expect(escapeMarkdownV2('a=b')).toBe('a\\=b');
  });

  it('escapes pipe', () => {
    expect(escapeMarkdownV2('a|b')).toBe('a\\|b');
  });

  it('escapes curly braces', () => {
    expect(escapeMarkdownV2('{key}')).toBe('\\{key\\}');
  });

  it('escapes dot', () => {
    expect(escapeMarkdownV2('file.txt')).toBe('file\\.txt');
  });

  it('escapes exclamation', () => {
    expect(escapeMarkdownV2('!alert')).toBe('\\!alert');
  });

  it('escapes server aliases with hyphens', () => {
    expect(escapeMarkdownV2('ai-gateway-prod')).toBe('ai\\-gateway\\-prod');
  });

  it('escapes AWS instance IDs', () => {
    expect(escapeMarkdownV2('i-0a1b2c3d4e5f67890')).toBe('i\\-0a1b2c3d4e5f67890');
  });

  it('escapes combined markdown special characters', () => {
    const input = '_*[]()~`>#+-=|{}.!';
    const expected =
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!';
    expect(escapeMarkdownV2(input)).toBe(expected);
  });

  it('does not modify plain text without special characters', () => {
    expect(escapeMarkdownV2('hello world')).toBe('hello world');
  });

  it('does not modify alphanumeric strings', () => {
    expect(escapeMarkdownV2('abc123XYZ')).toBe('abc123XYZ');
  });

  it('escapes text with multiple hyphens and underscores', () => {
    const input = 'my_server-01_status-check';
    const expected = 'my\\_server\\-01\\_status\\-check';
    expect(escapeMarkdownV2(input)).toBe(expected);
  });
});
