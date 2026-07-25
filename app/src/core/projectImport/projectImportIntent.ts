export function detectImportExistingProjectIntent(prompt: string): boolean {
  const text = prompt.trim();
  return /\b(import\s+existing\s+project|add\s+existing\s+project|track\s+this\s+project|open\s+and\s+remember\s+this\s+project)\b/i.test(text) ||
    /\bpull\s+in\s+.+/i.test(text);
}
