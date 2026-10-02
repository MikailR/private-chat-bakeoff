import type { ChatMessage } from './types';

const HISTORY_BUDGET = 1200;

function oneLine(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function buildPrompt(messages: ChatMessage[]): string {
  const usable = messages.filter((message) => message.content.trim());
  if (usable.length === 0) return 'Hello';
  if (usable.length === 1) return oneLine(usable[0].content, 900);

  const lines: string[] = [];
  let used = 0;
  const kept: ChatMessage[] = [];
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const line = oneLine(usable[i].content, 500);
    if (kept.length > 0 && used + line.length > HISTORY_BUDGET) break;
    kept.push(usable[i]);
    used += line.length;
  }
  kept.reverse();
  for (const message of kept) {
    const speaker = message.role === 'user' ? 'Q' : 'A';
    lines.push(`${speaker}: ${oneLine(message.content, 500)}`);
  }
  lines.push('A:');
  return lines.join('\n');
}

export function cleanReply(text: string): string {
  let out = text.replace(/\r/g, '').trim();
  const cutAt = ['\nUser:', '\nAssistant:', '\n###', '\nQuestion:', '\nInstruction:', '\nQ:', '\nA:'];
  for (const marker of cutAt) {
    const index = out.indexOf(marker);
    if (index >= 0) out = out.slice(0, index).trim();
  }
  out = out.replace(/^(answer|assistant|kiln|response|a)\s*:\s*/i, '').trim();
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 41)}…`;
}
