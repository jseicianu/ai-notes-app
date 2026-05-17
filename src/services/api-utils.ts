import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ModelOptions } from "@/services/model-service";

export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for backend execution");
  }

  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export async function getAuthenticatedUser(request?: NextRequest) {
  const authorization = request?.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const supabase = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: authorization } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    return user;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireWorkspace(
  request: NextRequest,
  workspaceId: string,
  client?: SupabaseClient
) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,settings")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return {
      error: NextResponse.json({ error: "Workspace not found" }, { status: 404 }),
    };
  }

  return {
    user,
    workspace: {
      id: data.id as string,
      settings: (data.settings ?? {}) as Record<string, unknown>,
      modelProvider: stringSetting(data.settings ?? {}, "modelProvider", "model_provider", "defaultModelProvider"),
      modelName: stringSetting(data.settings ?? {}, "modelName", "model_name", "defaultModelName", "defaultModel"),
      modelOptions: getModelOptionsFromSettings((data.settings ?? {}) as Record<string, unknown>),
      tavilyApiKey: getTavilyApiKey((data.settings ?? {}) as Record<string, unknown>),
    },
  };
}

export function getModelOptionsFromSettings(
  settings: Record<string, unknown>
): ModelOptions {
  const localModels = objectSetting(settings.localModels);
  const apiKeys = objectSetting(settings.apiKeys);

  return {
    localBaseUrl:
      stringSetting(localModels, "ollamaUrl") ||
      stringSetting(localModels, "lmStudioUrl"),
    localModelName: stringSetting(localModels, "modelName"),
    apiKeys: {
      anthropic: stringSetting(apiKeys, "anthropic"),
      openai: stringSetting(apiKeys, "openai"),
      google: stringSetting(apiKeys, "google"),
    },
  };
}

export function getTavilyApiKey(settings: Record<string, unknown>) {
  const apiKeys = objectSetting(settings.apiKeys);
  return (
    stringSetting(settings, "tavily_api_key", "tavilyApiKey") ||
    stringSetting(apiKeys, "tavily", "tavily_api_key", "tavilyApiKey")
  );
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    { error: message, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

export function createSseStream(
  handler: (send: (event: string, data: unknown) => void) => Promise<void>
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        await handler(send);
      } catch (error) {
        send("error", serializeError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, details: error.stack };
  }

  return { message: "Unknown error", details: error };
}

export function stringSetting(settings: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

export function objectSetting(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
