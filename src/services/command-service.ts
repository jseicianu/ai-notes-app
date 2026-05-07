import Ajv, { type ErrorObject } from "ajv";
import { createClient } from "@/lib/supabase/server";
import type {
  Command,
  CommandInput,
  CommandVersion,
} from "@/lib/models/types";

interface CreateCommandParams {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  promptTemplate: string;
  inputs: CommandInput[];
  outputSchema: object;
  allowedTools: string[];
  contextConfig?: object;
  modelProvider?: string;
  modelName?: string;
  isCallable?: boolean;
  sourceRunId?: string;
}

interface DbError {
  message: string;
  code?: string;
}

function assertData<T>(data: T | null, error: DbError | null): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Supabase returned no data");
  return data;
}

function isUniqueViolation(error: DbError | null) {
  return error?.code === "23505";
}

function commandSlugError() {
  return new Error("A command with this slug already exists in this workspace.");
}

async function insertCommandVersion(command: Command) {
  const supabase = await createClient();
  const { error } = await supabase.from("command_versions").insert({
    command_id: command.id,
    version: command.version,
    prompt_template: command.prompt_template,
    inputs: command.inputs,
    output_schema: command.output_schema,
    allowed_tools: command.allowed_tools,
  });

  if (error) throw new Error(error.message);
}

export async function createCommand(
  params: CreateCommandParams
): Promise<Command> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name,
      slug: params.slug,
      description: params.description,
      prompt_template: params.promptTemplate,
      inputs: params.inputs,
      output_schema: params.outputSchema,
      allowed_tools: params.allowedTools,
      context_config: params.contextConfig ?? {},
      model_provider: params.modelProvider,
      model_name: params.modelName,
      is_callable: params.isCallable ?? false,
      source_run_id: params.sourceRunId,
    })
    .select()
    .single();

  if (isUniqueViolation(error)) throw commandSlugError();

  const command = assertData(data as Command | null, error);
  await insertCommandVersion(command);
  return command;
}

export async function updateCommand(
  commandId: string,
  updates: Partial<Command>
): Promise<Command> {
  const current = await getCommand(commandId);
  const allowedKeys: Array<keyof Command> = [
    "name",
    "slug",
    "description",
    "prompt_template",
    "inputs",
    "output_schema",
    "allowed_tools",
    "context_config",
    "model_provider",
    "model_name",
    "is_callable",
    "source_run_id",
    "is_archived",
  ];

  const payload: Record<string, unknown> = {
    version: current.version + 1,
    updated_at: new Date().toISOString(),
  };

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .update(payload)
    .eq("id", commandId)
    .select()
    .single();

  if (isUniqueViolation(error)) throw commandSlugError();

  const command = assertData(data as Command | null, error);
  await insertCommandVersion(command);
  return command;
}

export async function getCommand(commandId: string): Promise<Command> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .select()
    .eq("id", commandId)
    .single();

  return assertData(data as Command | null, error);
}

export async function getCommandBySlug(
  workspaceId: string,
  slug: string
): Promise<Command> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .select()
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .eq("is_archived", false)
    .single();

  return assertData(data as Command | null, error);
}

export async function listCommands(workspaceId: string): Promise<Command[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .select()
    .eq("workspace_id", workspaceId)
    .eq("is_archived", false)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Command[];
}

export async function archiveCommand(commandId: string): Promise<void> {
  await updateCommand(commandId, { is_archived: true });
}

export async function getCommandVersions(
  commandId: string
): Promise<CommandVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("command_versions")
    .select()
    .eq("command_id", commandId)
    .order("version", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommandVersion[];
}

export function validateOutput(
  output: unknown,
  schema: object
): { valid: boolean; errors?: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(output);

  if (valid) return { valid: true };

  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatAjvError),
  };
}

export function fillTemplate(
  template: string,
  inputs: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => inputs[key] ?? "");
}

function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || "/";
  return `${path} ${error.message ?? "is invalid"}`;
}
