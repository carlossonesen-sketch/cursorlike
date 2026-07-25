export function isModelProviderUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|quota|rate\s*limit|billing|exceeded your current quota|insufficient_quota)\b/i.test(message);
}

export function formatModelProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isModelProviderUnavailableError(error)) {
    return "The configured model provider quota is exceeded. NF will use offline task fallbacks when available.";
  }
  return message;
}
