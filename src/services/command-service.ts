import Ajv, { type ErrorObject } from "ajv";
import { createClient } from "@/lib/supabase/server";
import type {
  Command,
  CommandInput,
  CommandVersion,
} from "@/lib/models/types";
export {
  validateInputs,
  type InputValidationError,
  type ValidationRule,
} from "@/lib/validate-inputs";

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
): SchemaValidationResult {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(output);

  if (valid) return { valid: true };

  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) =>
      formatAjvError(error, output)
    ),
  };
}

export interface SchemaValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    expected: string;
    actual: string;
  }>;
}

export interface CommandVersionDiff {
  promptChanged: boolean;
  inputsChanged: boolean;
  schemaChanged: boolean;
  toolsChanged: boolean;
  promptDiff?: { added: string[]; removed: string[] };
  inputsDiff?: { added: string[]; removed: string[]; modified: string[] };
  schemaDiff?: { added: string[]; removed: string[]; modified: string[] };
  toolsDiff?: { added: string[]; removed: string[] };
}

export function diffCommandVersions(
  v1: {
    prompt_template: string;
    inputs: unknown[];
    output_schema: Record<string, unknown>;
    allowed_tools?: string[];
  },
  v2: {
    prompt_template: string;
    inputs: unknown[];
    output_schema: Record<string, unknown>;
    allowed_tools?: string[];
  }
): CommandVersionDiff {
  const promptDiff = diffLines(v1.prompt_template, v2.prompt_template);
  const inputsDiff = diffInputs(v1.inputs, v2.inputs);
  const toolsDiff = diffArrays(v1.allowed_tools ?? [], v2.allowed_tools ?? []);
  const schemaChanged =
    stableStringify(v1.output_schema) !== stableStringify(v2.output_schema);

  return {
    promptChanged:
      promptDiff.added.length > 0 || promptDiff.removed.length > 0,
    inputsChanged:
      inputsDiff.added.length > 0 ||
      inputsDiff.removed.length > 0 ||
      inputsDiff.modified.length > 0,
    schemaChanged,
    toolsChanged: toolsDiff.added.length > 0 || toolsDiff.removed.length > 0,
    promptDiff,
    inputsDiff,
    schemaDiff: schemaChanged ? { added: [], removed: [], modified: ["/"] } : undefined,
    toolsDiff,
  };
}

export function fillTemplate(
  template: string,
  inputs: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => inputs[key] ?? "");
}

function formatAjvError(error: ErrorObject, output: unknown) {
  const path = error.instancePath || "/";
  return {
    path,
    message: error.message ?? "is invalid",
    expected: JSON.stringify(error.params),
    actual: describeValue(valueAtPath(output, path)),
  };
}

function valueAtPath(value: unknown, path: string) {
  if (!path || path === "/") return value;
  return path
    .split("/")
    .slice(1)
    .reduce<unknown>((current, segment) => {
      if (typeof current !== "object" || current === null) return undefined;
      const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
      return (current as Record<string, unknown>)[key];
    }, value);
}

function describeValue(value: unknown) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function diffLines(before: string, after: string) {
  const beforeLines = new Set(before.split(/\r?\n/));
  const afterLines = new Set(after.split(/\r?\n/));
  return {
    added: [...afterLines].filter((line) => !beforeLines.has(line)),
    removed: [...beforeLines].filter((line) => !afterLines.has(line)),
  };
}

function diffArrays(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((item) => !beforeSet.has(item)),
    removed: before.filter((item) => !afterSet.has(item)),
  };
}

function diffInputs(before: unknown[], after: unknown[]) {
  const beforeMap = new Map(before.map((input) => [inputName(input), input]));
  const afterMap = new Map(after.map((input) => [inputName(input), input]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [name, input] of afterMap) {
    if (!name) continue;
    if (!beforeMap.has(name)) {
      added.push(name);
    } else if (stableStringify(beforeMap.get(name)) !== stableStringify(input)) {
      modified.push(name);
    }
  }

  for (const name of beforeMap.keys()) {
    if (name && !afterMap.has(name)) removed.push(name);
  }

  return { added, removed, modified };
}

function inputName(input: unknown) {
  return typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).name === "string"
    ? ((input as Record<string, unknown>).name as string)
    : "";
}

function stableStringify(value: unknown) {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}) {
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(child, keys);
    }
  }
  return keys;
}
