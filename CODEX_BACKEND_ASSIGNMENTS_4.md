# Codex Backend Assignments — Round 4: Source Picker Backend

## Context

The app needs a unified "source" system so AI cells and commands can read from multiple input types: uploaded files, URLs (scraped web pages), specific blocks on the page, and workspace-wide RAG search. The frontend will show a source picker UI, but the backend needs to support resolving heterogeneous sources into context for AI execution.

**Existing services that already work:**
- `src/services/web-tools.ts` — `webSearch(query)` and `webScrape(url)` already implemented
- `src/services/embedding-service.ts` — `embedContent()`, `searchWorkspace()`, `deleteEmbeddings()` already implemented
- `src/app/api/ai/run/route.ts` — context assembly works for block content, needs extending for new source types
- `src/app/api/ai/command/route.ts` — command execution with template filling
- File upload to Supabase Storage already works via file blocks
- `src/lib/models/types.ts` has `isSourceInput()` and `input_mode: "source" | "text"` on CommandInput

## Assignment 17: Source Resolution Service

**File:** `src/services/source-service.ts`

Create a service that resolves a list of heterogeneous sources into text content for AI context assembly.

```typescript
export type SourceReference =
  | { type: "block"; blockId: string }
  | { type: "file"; fileId: string }
  | { type: "url"; url: string }
  | { type: "paste"; content: string }
  | { type: "rag"; query: string; limit?: number };

export interface ResolvedSource {
  type: SourceReference["type"];
  label: string;          // human-readable label (filename, URL, block type, etc.)
  content: string;        // the extracted text content
  metadata?: {
    url?: string;
    filename?: string;
    mimeType?: string;
    blockId?: string;
    similarity?: number;
  };
}

// Resolve a list of source references into text content
export async function resolveSources(
  sources: SourceReference[],
  workspaceId: string
): Promise<ResolvedSource[]>
```

Implementation details:
- **block**: Load block from `blocks` table, extract text content from `content` jsonb. Use `safeStringify` for non-text types.
- **file**: Load file record from `files` table, return `extracted_text`. If `extracted_text` is null, fetch from Supabase Storage and extract (PDF via `pdf-parse`, CSV/TXT/MD as raw text). Update the `extracted_text` field for caching.
- **url**: Call `webScrape(url)` from `src/services/web-tools.ts`. Return the scraped content.
- **paste**: Return content directly (no resolution needed).
- **rag**: Call `searchWorkspace({ workspaceId, query, limit })` from `src/services/embedding-service.ts`. Concatenate top results.

Use `src/lib/supabase/server.ts` `createClient()` for all DB access.

## Assignment 18: File Text Extraction

**File:** `src/services/file-extraction-service.ts`

Create a service for extracting text content from uploaded files:

```typescript
export async function extractFileText(params: {
  storagePath: string;
  mimeType: string;
  filename: string;
}): Promise<string>
```

Supported formats:
- `text/plain`, `text/markdown` — return raw text
- `text/csv` — return raw CSV text (AI can interpret it)
- `application/pdf` — use `pdf-parse` (already in dependencies/serverExternalPackages)
- `application/json` — return formatted JSON string
- Other types — return `"[Unsupported file type: {mimeType}]"`

Fetch file bytes from Supabase Storage using:
```typescript
const { data, error } = await supabase.storage
  .from("files")
  .download(storagePath);
```

## Assignment 19: Update AI Run Route for Source Inputs

**File:** `src/app/api/ai/run/route.ts`

Update the run request schema and context assembly to accept source references:

1. Add `sources` to the request body schema:
```typescript
sources: z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("block"), blockId: z.string() }),
  z.object({ type: z.literal("file"), fileId: z.string() }),
  z.object({ type: z.literal("url"), url: z.string() }),
  z.object({ type: z.literal("paste"), content: z.string() }),
  z.object({ type: z.literal("rag"), query: z.string(), limit: z.number().optional() }),
])).optional().default([]),
```

2. In the POST handler, after reading input variables, resolve sources:
```typescript
import { resolveSources } from "@/services/source-service";

const resolvedSources = body.sources.length > 0
  ? await resolveSources(body.sources, body.workspaceId)
  : [];
```

3. Update `buildUserPrompt` to include resolved sources:
```typescript
function buildUserPrompt(body, inputVariables, resolvedSources) {
  const inputs = formatInputVariables(inputVariables);
  const context = assembleContext(body.contextBlocks);
  const sources = resolvedSources.length > 0
    ? resolvedSources.map((s, i) =>
        `<source index="${i + 1}" type="${s.type}" label="${s.label}">\n${s.content}\n</source>`
      ).join("\n\n")
    : null;

  const sections = [
    body.prompt,
    inputs ? `Input variables:\n${inputs}` : null,
    sources ? `Sources:\n${sources}` : null,
    context ? `Context blocks:\n${context}` : null,
  ].filter(Boolean);

  return sections.join("\n\n");
}
```

4. Record resolved sources in the run's `context_used` field.

## Assignment 20: Update Command Execution Route for Sources

**File:** `src/app/api/ai/command/route.ts`

Same pattern as Assignment 19, but for command execution:
1. Accept `sources` in the request body
2. Resolve sources before building the prompt
3. Include resolved source content in the command's context
4. Record in run's `context_used`

## Assignment 21: Auto-embed Uploaded Files

**File:** Update `src/app/api/ai/run/route.ts` or create a new route `src/app/api/files/route.ts`

When a file is uploaded (file block created), automatically:
1. Extract text content via `extractFileText`
2. Update the `files` table with `extracted_text`
3. Call `embedContent` to index the file for RAG search

This ensures uploaded files are searchable via `search_workspace` immediately.

If a file upload API route doesn't exist yet, the embedding can be triggered when a source of type `file` is first resolved — the `resolveSources` function can lazily extract and embed.

## Testing

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All must pass. Test that the existing AI run route still works with empty `sources` array (backwards compatible).

## File structure after completion

```
src/
  services/
    source-service.ts          ← Assignment 17
    file-extraction-service.ts ← Assignment 18
    web-tools.ts               ← existing (used by source-service)
    embedding-service.ts       ← existing (used by source-service)
  app/
    api/
      ai/
        run/route.ts           ← Assignment 19
        command/route.ts       ← Assignment 20
```
