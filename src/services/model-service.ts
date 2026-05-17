import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GOOGLE_MODEL = "gemini-2.0-flash";
const DEFAULT_LOCAL_MODEL = "gemma4:31b";

export type ModelProvider = "anthropic" | "openai" | "google" | "local";

export interface ModelOptions {
  localBaseUrl?: string;
  localModelName?: string;
  apiKey?: string;
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
}

export function getModel(
  provider: string,
  modelName?: string,
  options?: ModelOptions
) {
  const effectiveModelName = modelName === "local-ollama" ? undefined : modelName;
  switch (provider) {
    case "openai": {
      const providerInstance = options?.apiKey || options?.apiKeys?.openai
        ? createOpenAI({ apiKey: options.apiKey || options.apiKeys?.openai })
        : openai;

      return providerInstance(
        effectiveModelName || process.env.OPENAI_MODEL_NAME || DEFAULT_OPENAI_MODEL
      );
    }
    case "google": {
      const providerInstance = options?.apiKey || options?.apiKeys?.google
        ? createGoogleGenerativeAI({
            apiKey: options.apiKey || options.apiKeys?.google,
          })
        : google;

      return providerInstance(
        effectiveModelName || process.env.GOOGLE_MODEL_NAME || DEFAULT_GOOGLE_MODEL
      );
    }
    case "local": {
      const baseURL = withoutTrailingSlash(
        options?.localBaseUrl ||
          process.env.LOCAL_MODEL_BASE_URL ||
          "http://localhost:11434"
      );
      const localProvider = createOpenAI({
        baseURL: `${baseURL}/v1`,
        apiKey: options?.apiKey || process.env.LOCAL_MODEL_API_KEY || "ollama",
      });

      return localProvider(
        effectiveModelName ||
          options?.localModelName ||
          process.env.LOCAL_MODEL_NAME ||
          DEFAULT_LOCAL_MODEL
      );
    }
    case "anthropic":
    default: {
      const providerInstance = options?.apiKey || options?.apiKeys?.anthropic
        ? createAnthropic({
            apiKey: options.apiKey || options.apiKeys?.anthropic,
          })
        : anthropic;

      return providerInstance(
        effectiveModelName || process.env.ANTHROPIC_MODEL_NAME || DEFAULT_ANTHROPIC_MODEL
      );
    }
  }
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function listAvailableModels(): { provider: string; models: string[] }[] {
  return [
    {
      provider: "anthropic",
      models: [
        process.env.ANTHROPIC_MODEL_NAME || DEFAULT_ANTHROPIC_MODEL,
        "claude-sonnet-4-5",
        "claude-opus-4-5",
        "claude-haiku-4-5",
      ],
    },
    {
      provider: "openai",
      models: [
        process.env.OPENAI_MODEL_NAME || DEFAULT_OPENAI_MODEL,
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
      ],
    },
    {
      provider: "google",
      models: [
        process.env.GOOGLE_MODEL_NAME || DEFAULT_GOOGLE_MODEL,
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ],
    },
    {
      provider: "local",
      models: [process.env.LOCAL_MODEL_NAME || DEFAULT_LOCAL_MODEL],
    },
  ];
}

export function supportsVision(provider: string, model: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();

  if (normalizedProvider === "anthropic") {
    return (
      normalizedModel.includes("claude-3") ||
      normalizedModel.includes("claude-sonnet") ||
      normalizedModel.includes("claude-opus")
    );
  }

  if (normalizedProvider === "openai") {
    return (
      normalizedModel.includes("gpt-4o") ||
      normalizedModel.includes("gpt-4-turbo") ||
      normalizedModel.includes("gpt-4.1")
    );
  }

  if (normalizedProvider === "google") {
    return (
      normalizedModel.includes("gemini-1.5") ||
      normalizedModel.includes("gemini-2.")
    );
  }

  if (normalizedProvider === "local") {
    return (
      normalizedModel.includes("llava") ||
      normalizedModel.includes("vision")
    );
  }

  return false;
}
