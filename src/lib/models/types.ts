import { z } from "zod";

export const BlockType = z.enum([
  "text",
  "heading",
  "bulleted_list",
  "numbered_list",
  "ai_cell",
  "output",
  "table",
  "json",
  "todo",
  "file",
  "source_card",
  "command_ref",
  "callout",
  "separator",
  "input",
  "input_group",
  "error",
  "code",
  "image",
]);
export type BlockType = z.infer<typeof BlockType>;

export const RunStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunType = z.enum([
  "ai_cell",
  "command",
  "web_scrape",
  "rag_search",
  "file_extraction",
  "test",
]);
export type RunType = z.infer<typeof RunType>;

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Notebook {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  notebook_id: string;
  workspace_id: string;
  title: string;
  description: string;
  tags: string[];
  sort_order: number;
  is_archived: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  usage_count: number;
  created_at: string;
}

export interface Block {
  id: string;
  page_id: string;
  workspace_id: string;
  type: BlockType;
  content: Record<string, unknown>;
  sort_order: number;
  parent_block_id: string | null;
  column_group: string | null;
  column_index: number;
  version: number;
  is_collapsed: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlockVersion {
  id: string;
  block_id: string;
  version: number;
  content: Record<string, unknown>;
  type: BlockType;
  created_at: string;
}

export type AiCellContextMode = "selected_sources" | "blocks_above" | "none";

export interface Run {
  id: string;
  workspace_id: string;
  page_id: string | null;
  trigger_block_id: string | null;
  command_id: string | null;
  parent_run_id: string | null;
  type: RunType;
  status: RunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  output_block_ids: string[];
  model_provider: string | null;
  model_name: string | null;
  context_used: Array<{ type: string; id: string; label: string }>;
  tools_used: string[];
  schema_validation: string | null;
  error: { message: string; code?: string; details?: unknown } | null;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Command {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  prompt_template: string;
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
    default_value?: string;
    min?: number;
    max?: number;
    options?: string[];
    input_mode?: "source" | "text";
    validation?: {
      min?: number;
      max?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      patternMessage?: string;
    };
  }>;
  output_schema: Record<string, unknown>;
  allowed_tools: string[];
  context_config: Record<string, unknown>;
  model_provider: string | null;
  model_name: string | null;
  is_callable: boolean;
  version: number;
  source_run_id: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export type CommandInput = Command["inputs"][number];

export interface SourceConfig {
  required: boolean;
  accepted_types: ("block" | "file" | "url" | "paste" | "rag")[];
  default_mode: "ask_each_time" | "selected_blocks" | "current_page" | "above_command";
  exclude_previous_outputs: boolean;
  multi_select: boolean;
}

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  required: true,
  accepted_types: ["block", "file", "url", "paste"],
  default_mode: "ask_each_time",
  exclude_previous_outputs: true,
  multi_select: true,
};

export function getSourceConfig(command: Command): SourceConfig | null {
  const config = command.context_config;
  if (!config || typeof config !== "object") return null;
  const raw = (config as Record<string, unknown>).source;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.required !== "boolean" || !Array.isArray(s.accepted_types)) return null;
  return raw as SourceConfig;
}

const SOURCE_TEXT_NAME_PATTERN = /^(source|source_text|source_content|content|body|document|article|notes)$/i;
const LEGACY_SOURCE_STRING_NAME_PATTERN = /^source(?:_(?:text|content|body|document|article|notes))?$/i;

export function isSourceInput(input: CommandInput): boolean {
  if (input.input_mode === "source") return true;
  if (input.input_mode === "text") return false;
  if (input.type === "source") return true;
  if (input.type === "text") return SOURCE_TEXT_NAME_PATTERN.test(input.name);
  if (input.type === "string") return LEGACY_SOURCE_STRING_NAME_PATTERN.test(input.name);
  return false;
}

export interface CommandVersion {
  id: string;
  command_id: string;
  version: number;
  prompt_template: string;
  inputs: CommandInput[];
  output_schema: Record<string, unknown>;
  allowed_tools: string[];
  created_at: string;
}

export interface Schedule {
  id: string;
  workspace_id: string;
  command_id: string;
  preset_id: string | null;
  target_page_id: string | null;
  input_values: Record<string, unknown>;
  source_refs: unknown[];
  output_mode: "append" | "replace" | "version";
  name: string;
  cron_expression: string;
  timezone: string;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_id: string | null;
  last_error?: Record<string, unknown> | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuggestedInput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  source?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface FileRecord {
  id: string;
  workspace_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  extracted_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SearchResult {
  id: string;
  content: string;
  sourceType: "block" | "page" | "file" | "web";
  sourceId: string;
  similarity: number;
  metadata: {
    breadcrumb: string;
    pageId?: string;
    pageTitle?: string;
    notebookId?: string;
    notebookName?: string;
    blockType?: string;
    filename?: string;
    url?: string;
    title?: string;
  };
}
