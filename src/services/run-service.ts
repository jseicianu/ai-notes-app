import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Run, RunStatus, RunType } from "@/lib/models/types";

type JsonObject = Record<string, unknown>;

interface CreateRunParams {
  workspaceId: string;
  pageId: string | null;
  triggerBlockId: string | null;
  commandId?: string;
  parentRunId?: string;
  type: RunType;
  input: JsonObject;
  modelProvider: string;
  modelName: string;
}

interface UpdateRunStatusUpdates {
  output?: JsonObject;
  outputBlockIds?: string[];
  contextUsed?: object[];
  toolsUsed?: string[];
  schemaValidation?: string;
  error?: object;
  tokenUsage?: object;
  durationMs?: number;
  completedAt?: string;
}

async function getSupabase(client?: SupabaseClient) {
  return client ?? (await createClient());
}

function assertData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Supabase returned no data");
  return data;
}

export async function createRun(
  params: CreateRunParams,
  client?: SupabaseClient
): Promise<Run> {
  const supabase = await getSupabase(client);
  const { data, error } = await supabase
    .from("runs")
    .insert({
      workspace_id: params.workspaceId,
      page_id: params.pageId,
      trigger_block_id: params.triggerBlockId,
      command_id: params.commandId,
      parent_run_id: params.parentRunId,
      type: params.type,
      status: "running",
      input: params.input,
      model_provider: params.modelProvider,
      model_name: params.modelName,
    })
    .select()
    .single();

  return assertData(data as Run | null, error);
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  updates: UpdateRunStatusUpdates = {},
  client?: SupabaseClient
): Promise<Run> {
  const supabase = await getSupabase(client);
  const payload: Record<string, unknown> = { status };

  if (updates.output !== undefined) payload.output = updates.output;
  if (updates.outputBlockIds !== undefined) {
    payload.output_block_ids = updates.outputBlockIds;
  }
  if (updates.contextUsed !== undefined) payload.context_used = updates.contextUsed;
  if (updates.toolsUsed !== undefined) payload.tools_used = updates.toolsUsed;
  if (updates.schemaValidation !== undefined) {
    payload.schema_validation = updates.schemaValidation;
  }
  if (updates.error !== undefined) payload.error = updates.error;
  if (updates.tokenUsage !== undefined) payload.token_usage = updates.tokenUsage;
  if (updates.durationMs !== undefined) payload.duration_ms = updates.durationMs;
  if (updates.completedAt !== undefined) {
    payload.completed_at = updates.completedAt;
  } else if (["completed", "failed", "cancelled"].includes(status)) {
    payload.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("runs")
    .update(payload)
    .eq("id", runId)
    .select()
    .single();

  return assertData(data as Run | null, error);
}

export async function getRunsByBlock(
  workspaceId: string,
  triggerBlockId: string
): Promise<Run[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select()
    .eq("workspace_id", workspaceId)
    .eq("trigger_block_id", triggerBlockId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Run[];
}

export async function getRunsByPage(
  workspaceId: string,
  pageId: string
): Promise<Run[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select()
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Run[];
}

export async function getRecentRuns(
  workspaceId: string,
  limit = 25
): Promise<Run[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select()
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Run[];
}
