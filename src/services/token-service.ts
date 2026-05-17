export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getModelContextLimit(provider: string, model: string): number {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();

  if (normalizedProvider === "anthropic") {
    if (
      normalizedModel.includes("claude-sonnet-4") ||
      normalizedModel.includes("claude-opus-4") ||
      normalizedModel.includes("claude-haiku-4")
    ) {
      return 200000;
    }
    return 200000;
  }

  if (normalizedProvider === "openai") {
    if (
      normalizedModel.includes("gpt-4o") ||
      normalizedModel.includes("gpt-4-turbo") ||
      normalizedModel.includes("gpt-4.1")
    ) {
      return 128000;
    }
    return 128000;
  }

  if (normalizedProvider === "google") {
    if (normalizedModel.includes("gemini-1.5-pro")) return 2000000;
    if (
      normalizedModel.includes("gemini-2.0") ||
      normalizedModel.includes("gemini-2.5") ||
      normalizedModel.includes("gemini-1.5")
    ) {
      return 1000000;
    }
  }

  if (normalizedProvider === "local") return 8192;

  return 100000;
}
