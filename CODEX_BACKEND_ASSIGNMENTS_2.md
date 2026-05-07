# Codex Backend Assignments — Round 2

## Context

Phase 3 backend services are built. This round covers:
1. Fixing critical issues from Round 1
2. Phase 4/5 backend: Make Reusable + Command execution support
3. Phase 6 backend: Web tools + RAG embedding pipeline

## Assignment 7: Fix Critical Issues from Round 1

### 7a. Fix model defaults in `src/services/model-service.ts`

The default model names are incorrect and will fail at runtime. Fix them:

```typescript
// WRONG:
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";

// CORRECT:
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GOOGLE_MODEL = "gemini-2.0-flash";
```

Also update `listAvailableModels()` to return real model names.

### 7b. Add workspace isolation to run-service queries

In `src/services/run-service.ts`, the query functions `getRunsByBlock`, `getRunsByPage`, and `getRecentRuns` should filter by `workspace_id`:

```typescript
// getRunsByBlock should accept workspaceId and filter:
.eq("workspace_id", workspaceId)

// Same for getRunsByPage and getRecentRuns
```

Update function signatures to require `workspaceId` as a parameter.

### 7c. Add parent_block_id validation in notebook-tools.ts

Before creating a block in the `insertBlock` helper, verify the parent block exists and belongs to the same workspace:

```typescript
if (context.parentBlockId) {
  const { data: parent } = await supabase
    .from("blocks")
    .select("id")
    .eq("id", context.parentBlockId)
    .eq("workspace_id", context.workspaceId)
    .single();
  if (!parent) throw new Error("Parent block not found in workspace");
}
```

### 7d. Fix command slug uniqueness

The unique constraint already exists in the database (`UNIQUE(workspace_id, slug)`), but `command-service.ts` should catch the unique violation error and return a user-friendly message instead of a raw Postgres error.

## Assignment 8: Command Execution API Route

**File:** `src/app/api/ai/command/route.ts`

Build a POST endpoint for running saved commands (separate from ad-hoc AI cell runs):

1. Accepts: `{ commandId, inputs, workspaceId, pageId, triggerBlockId }`
2. Loads the command from DB
3. Fills the prompt template with provided inputs (replace `{{input_name}}` placeholders)
4. Assembles context based on `command.context_config`
5. Creates a run record (type: 'command', command_id set)
6. Calls the AI model with the command's specified model/provider (or workspace default)
7. Passes only the command's `allowed_tools` to the model
8. Streams response
9. On completion: validates output against `command.output_schema` using `validateOutput` from command-service
10. If validation fails: auto-retry once with a repair prompt explaining what was missing
11. Updates run record with schema_validation status

The template filling should handle:
```typescript
function fillTemplate(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => inputs[key] ?? "");
}
```

## Assignment 9: Internal Callability — `run_command` Tool

**File:** Update `src/services/notebook-tools.ts`

Add a new tool `run_command` that AI cells can use to call saved commands internally:

```typescript
run_command: tool({
  description: "Run a saved command by its slug and return structured output",
  parameters: z.object({
    slug: z.string().describe("Command slug, e.g. 'extract-research'"),
    inputs: z.record(z.string()).describe("Input values for the command"),
  }),
  execute: async ({ slug, inputs }) => {
    // 1. Load command by slug from the workspace
    // 2. Verify command.is_callable === true
    // 3. Fill prompt template with inputs
    // 4. Create a nested run (parent_run_id = current run ID)
    // 5. Execute the command's prompt with its allowed tools
    // 6. Validate output against command.output_schema
    // 7. Return the structured output to the calling AI cell
  },
})
```

This requires passing the current run ID through the tool context so nested runs can be linked.

Update the `NotebookToolContext` interface to include `currentRunId: string`.

## Assignment 10: Web Search Tool

**File:** `src/services/web-tools.ts`

Implement web search using the Tavily API:

```typescript
export async function webSearch(query: string, options?: {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
}): Promise<{
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}>
```

Also add a Tavily-based web search tool to `notebook-tools.ts`:

```typescript
web_search: tool({
  description: "Search the web for information",
  parameters: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    const results = await webSearch(query, { maxResults: 5 });
    return results;
  },
})
```

The Tavily API key is in `process.env.TAVILY_API_KEY`.

Tavily API endpoint: `https://api.tavily.com/search`
Request body: `{ api_key, query, max_results, search_depth }`

## Assignment 11: Web Scrape Tool

**File:** Add to `src/services/web-tools.ts`

Implement URL content extraction:

```typescript
export async function webScrape(url: string): Promise<{
  title: string;
  content: string;
  url: string;
  scrapedAt: string;
}>
```

Use `@extractus/article-extractor` (install it: `npm install @extractus/article-extractor`).

Add a web scrape tool to `notebook-tools.ts`:

```typescript
web_scrape: tool({
  description: "Fetch and extract readable content from a URL",
  parameters: z.object({
    url: z.string().url().describe("URL to scrape"),
  }),
  execute: async ({ url }) => {
    const result = await webScrape(url);
    // Also create a source_card block with the scraped content
    return result;
  },
})
```

## Assignment 12: Embedding Pipeline

**File:** `src/services/embedding-service.ts`

Build the RAG embedding pipeline:

```typescript
// Generate embeddings for content
export async function embedContent(params: {
  workspaceId: string;
  sourceType: "block" | "file" | "page";
  sourceId: string;
  content: string;
}): Promise<void>
// Chunks text into ~500 token segments
// Generates embeddings via OpenAI text-embedding-3-small
// Upserts into embeddings table (delete old, insert new)

// Search workspace content
export async function searchWorkspace(params: {
  workspaceId: string;
  query: string;
  limit?: number;
}): Promise<Array<{
  content: string;
  sourceType: string;
  sourceId: string;
  similarity: number;
}>>
// Generates embedding for query
// Searches via pgvector cosine similarity
// Returns top-k results

// Delete embeddings when source is removed
export async function deleteEmbeddings(params: {
  sourceType: string;
  sourceId: string;
}): Promise<void>
```

For the vector search query, use Supabase's RPC or raw SQL:
```sql
SELECT content, source_type, source_id,
  1 - (embedding <=> $1) as similarity
FROM embeddings
WHERE workspace_id = $2
ORDER BY embedding <=> $1
LIMIT $3;
```

You'll need to create a Supabase RPC function for this. Add a new migration file:
`supabase/migrations/002_search_embeddings.sql`

```sql
create or replace function search_embeddings(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id uuid,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where e.workspace_id = match_workspace_id
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

Run this migration via the Supabase Management API:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/mdtaollvlqlmtjsszyit/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile sql supabase/migrations/002_search_embeddings.sql '{query: $sql}')"
```

The access token is `SUPABASE_ACCESS_TOKEN` in `.env.local`.

Also add a `search_workspace` tool to `notebook-tools.ts`.

## Testing

- Type-check: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`
- All must pass before considering assignments complete

## File structure after completion

```
src/
  app/
    api/
      ai/
        run/route.ts          ← existing (fix issues)
        command/route.ts      ← Assignment 8
  services/
    notebook-tools.ts         ← updated (Assignments 9, 10, 11)
    run-service.ts            ← updated (Assignment 7b)
    command-service.ts        ← updated (Assignment 7d)
    model-service.ts          ← updated (Assignment 7a)
    schema-service.ts         ← existing
    web-tools.ts              ← Assignment 10, 11
    embedding-service.ts      ← Assignment 12
  supabase/
    migrations/
      002_search_embeddings.sql  ← Assignment 12
```
