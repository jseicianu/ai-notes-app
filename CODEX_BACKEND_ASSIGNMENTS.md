# Codex Backend Assignments — Phase 3 Prep

These backend services should be built while the frontend block system (Phase 2) is being developed. They will be integrated once the block system is functional.

## Project context

- **Stack:** Next.js 16 (App Router), Supabase (Postgres + Auth + Storage), Vercel AI SDK
- **Schema:** All tables already exist in Supabase — see `supabase/migrations/001_initial_schema.sql`
- **Types:** TypeScript types are in `src/lib/models/types.ts`
- **Supabase helpers:** `src/lib/supabase/client.ts` (browser), `src/lib/supabase/server.ts` (server)
- **Auth:** Supabase Auth via proxy.ts (Next.js 16 renamed middleware → proxy)
- **AI SDK:** `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` are installed
- **Schema format:** Zod internally → JSON Schema for DB storage and LLM tool calling (`zod-to-json-schema`)
- **Env vars:** See `.env.local` for all keys and configuration

## Assignment 1: AI Execution API Route

**File:** `src/app/api/ai/run/route.ts`

Build a POST endpoint that:
1. Accepts: `{ prompt, contextBlocks, modelProvider, modelName, outputTypeHint, pageId, triggerBlockId, workspaceId }`
2. Creates a `run` record in Supabase (status: 'running')
3. Assembles context from the provided block contents
4. Calls the AI model via Vercel AI SDK (`streamText` or `generateObject`)
5. Streams response back via SSE
6. On completion: updates run record (status, token_usage, duration_ms, completed_at)
7. On failure: updates run record (status: 'failed', error)

**Key details:**
- Use the Vercel AI SDK provider based on `modelProvider`: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`
- Support streaming via AI SDK's built-in SSE support
- The `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` env vars provide auth
- Use the Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`) for server-side DB operations

## Assignment 2: Internal Notebook Tools (Zod Schemas)

**File:** `src/services/notebook-tools.ts`

Define Vercel AI SDK tools that the model can call during execution. Each tool should:
- Have a Zod schema for parameters
- Have an `execute` function that creates/reads blocks via Supabase

**Tools to implement:**

```typescript
// create_text_output — creates a text output block
// params: { content: string }
// action: insert block (type: 'output', content: { format: 'text', data: content })

// create_table — creates a table block
// params: { columns: string[], rows: Record<string, string>[] }
// action: insert block (type: 'table', content: { columns, rows })

// create_json — creates a JSON output block
// params: { data: object, label?: string }
// action: insert block (type: 'json', content: { data })

// create_todo — creates a todo block
// params: { items: { text: string, done: boolean }[] }
// action: insert block (type: 'todo', content: { items })

// create_source_card — creates a source card block
// params: { url: string, title: string, summary: string }
// action: insert block (type: 'source_card', content: { url, title, summary, scraped_at })

// read_block — reads a block's content by ID
// params: { blockId: string }
// returns: block content

// read_page — reads all blocks on a page
// params: { pageId: string }
// returns: array of block contents
```

Each tool's execute function receives `workspaceId` and `pageId` via closure/context, and the `parentBlockId` (the AI cell that triggered the run) so output blocks are linked.

## Assignment 3: Run Service

**File:** `src/services/run-service.ts`

Functions for managing run lifecycle:

```typescript
createRun(params: {
  workspaceId: string;
  pageId: string;
  triggerBlockId: string;
  commandId?: string;
  parentRunId?: string;
  type: RunType;
  input: object;
  modelProvider: string;
  modelName: string;
}): Promise<Run>

updateRunStatus(runId: string, status: RunStatus, updates?: {
  output?: object;
  outputBlockIds?: string[];
  contextUsed?: object[];
  toolsUsed?: string[];
  schemaValidation?: string;
  error?: object;
  tokenUsage?: object;
  durationMs?: number;
  completedAt?: string;
}): Promise<Run>

getRunsByBlock(triggerBlockId: string): Promise<Run[]>
getRunsByPage(pageId: string): Promise<Run[]>
getRecentRuns(workspaceId: string, limit?: number): Promise<Run[]>
```

Use `createClient` from `src/lib/supabase/server.ts` for all DB access.

## Assignment 4: Command Service

**File:** `src/services/command-service.ts`

Functions for command CRUD and execution:

```typescript
createCommand(params: {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  promptTemplate: string;
  inputs: CommandInput[];
  outputSchema: object;       // JSON Schema
  allowedTools: string[];
  contextConfig?: object;
  modelProvider?: string;
  modelName?: string;
  isCallable?: boolean;
  sourceRunId?: string;
}): Promise<Command>

updateCommand(commandId: string, updates: Partial<Command>): Promise<Command>
// Should auto-increment version and create a command_versions record

getCommand(commandId: string): Promise<Command>
getCommandBySlug(workspaceId: string, slug: string): Promise<Command>
listCommands(workspaceId: string): Promise<Command[]>
archiveCommand(commandId: string): Promise<void>

getCommandVersions(commandId: string): Promise<CommandVersion[]>

// Schema validation
validateOutput(output: unknown, schema: object): { valid: boolean; errors?: string[] }
```

For `validateOutput`, use Ajv or a JSON Schema validator to check AI output against the command's stored schema.

## Assignment 5: Schema Auto-Generation

**File:** `src/services/schema-service.ts`

Given an AI run's output blocks, generate a suggested command schema:

```typescript
generateSchemaFromOutput(outputBlocks: Block[]): {
  inputs: SuggestedInput[];
  outputSchema: object;      // JSON Schema
  outputType: string;        // 'text' | 'table' | 'json' | 'todo' | 'source_card' | 'multiple'
}

generateSchemaFromTable(columns: string[], rows: Record<string, unknown>[]): object
generateSchemaFromJson(data: unknown): object
```

This powers the "Make Reusable" drawer — when a user clicks Make Reusable, the frontend calls this to pre-populate the schema fields.

## Assignment 6: Model Provider Configuration

**File:** `src/services/model-service.ts`

Abstraction for selecting the right AI SDK provider:

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'anthropic':
      return anthropic(modelName);
    case 'openai':
      return openai(modelName);
    case 'google':
      return google(modelName);
    case 'local':
      const localProvider = createOpenAI({
        baseURL: process.env.LOCAL_MODEL_BASE_URL + '/v1',
        apiKey: 'ollama',  // Ollama doesn't need a real key
      });
      return localProvider(modelName || process.env.LOCAL_MODEL_NAME || 'gemma3:27b');
    default:
      return anthropic(modelName);
  }
}

function listAvailableModels(): { provider: string; models: string[] }[]
```

## Testing approach

- Each service should work independently
- Use the existing Supabase project for testing (Management API access documented in `.env.local`)
- Test with real API calls to verify Supabase operations work with RLS policies
- The AI execution route should be testable via curl with a valid auth token

## File structure after completion

```
src/
  app/
    api/
      ai/
        run/
          route.ts          ← Assignment 1
  services/
    notebook-tools.ts       ← Assignment 2
    run-service.ts          ← Assignment 3
    command-service.ts      ← Assignment 4
    schema-service.ts       ← Assignment 5
    model-service.ts        ← Assignment 6
```

## Important notes

- All DB operations must use the Supabase server client (not the browser client)
- RLS is enabled on all tables — operations go through the authenticated user's permissions
- Runs table has `parent_run_id` for tracking nested command calls (internal callability)
- The `vector` extension (not `pgvector`) is installed with schema `extensions`
- Next.js 16: uses `proxy.ts` instead of `middleware.ts`, function exported as `proxy` not `middleware`
