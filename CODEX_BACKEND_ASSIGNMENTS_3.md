# Codex Backend Assignments — Round 3

## Context

New block types have been added to the V1 scope. The frontend block type picker and type system now include: bulleted list, numbered list, callout, separator, and input blocks (text, number, slider, checkbox, select). Codex needs to update the backend services to support these.

## Assignment 13: Update Notebook Tools for New Block Types

**File:** `src/services/notebook-tools.ts`

Add new tools the AI can call during execution:

```typescript
// create_bulleted_list — creates a bulleted list block
// params: { items: string[] }
// action: insert block (type: 'bulleted_list', content: { doc: "<ul><li>item1</li>...</ul>" })

// create_numbered_list — creates a numbered list block
// params: { items: string[] }
// action: insert block (type: 'numbered_list', content: { doc: "<ol><li>item1</li>...</ol>" })

// create_callout — creates a callout block
// params: { type: "info" | "warning" | "tip" | "error", content: string }
// action: insert block (type: 'callout', content: { type, doc: content })

// read_inputs — reads all input block values on the current page
// params: { pageId: string }
// returns: Record<string, unknown> mapping variable_name → value
```

## Assignment 14: Context Assembly — Include Input Block Values

**File:** `src/app/api/ai/run/route.ts`

Update the context assembly logic to:
1. Query all blocks of type `input` on the current page
2. Collect their `variable_name` and `value` from content
3. Include them in the context sent to the model as named variables

Example context format:
```
Input variables:
- source_text = "quarterly earnings report"
- confidence_threshold = 75
- include_summary = true
```

Also update `src/app/api/ai/command/route.ts` to do the same — commands should be able to reference input block values via their variable names in prompt templates.

## Assignment 15: Update Schema Service for Input Blocks

**File:** `src/services/schema-service.ts`

When generating a schema from output blocks via Make Reusable, the service should:
1. Detect if the page has input blocks
2. Suggest those input blocks' variable names and types as the command's inputs
3. Map input block types to command input types:
   - `text` input → `text` command input
   - `number` input → `number` command input
   - `slider` input → `number` command input with min/max
   - `checkbox` input → `boolean` command input
   - `select` input → `text` command input with allowed values from options

## Assignment 16: Update Block Type Validation

**Files:** `src/lib/models/types.ts` (already updated), `src/services/notebook-tools.ts`

The BlockType enum now includes: `bulleted_list`, `numbered_list`, `callout`, `separator`, `input`.

Make sure all services that reference block types handle these new values:
- `run-service.ts` — no changes needed (type-agnostic)
- `command-service.ts` — no changes needed
- `notebook-tools.ts` — add the new tools (Assignment 13)
- `schema-service.ts` — handle new block types in schema inference (Assignment 15)

## Testing

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All must pass.
