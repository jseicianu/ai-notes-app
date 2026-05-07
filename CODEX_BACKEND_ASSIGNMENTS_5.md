# Codex Backend Assignments — Round 5: First-Class Source Config for Commands

## Context

Commands currently force users to manually create `{{source}}` text inputs. This is unintuitive — "source" (what AI reads) is fundamentally different from "parameters" (how AI behaves like audience, tone, count). We're adding a first-class `sourceConfig` to commands, stored inside the existing `context_config` jsonb column (no migration needed).

**Implementation order:** These backend tasks (CB1, CB2) must be completed first. The frontend (Claude) depends on the types and route behavior defined here.

**Important:** Do NOT change any frontend components, UI, or styling. Only touch the files listed below.

**Existing services that already work:**
- `src/services/source-service.ts` — `resolveSources()` handles block, file, url, paste, rag types
- `src/services/notebook-tools.ts` — `readControlPanelSources()` reads sources from control panel blocks
- `src/app/api/ai/command/route.ts` — already accepts `sources` array in request body
- `src/app/api/commands/route.ts` — already passes `contextConfig` through to create/update

---

## Assignment CB1: Add SourceConfig types

**File:** `src/lib/models/types.ts`

Add the following after the existing `CommandInput` type (around line 177):

```typescript
export interface SourceConfig {
  required: boolean;
  accepted_types: ("block" | "file" | "url" | "paste" | "rag")[];
  default_mode: "ask_each_time" | "selected_blocks" | "current_page" | "above_command";
  exclude_previous_outputs: boolean;
  multi_select: boolean;
}

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  required: true,
  accepted_types: ["block", "file", "url", "paste", "rag"],
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
```

**Do NOT change** the `Command` interface's `context_config` field type — it stays `Record<string, unknown>`. The helper reads from `context_config.source`.

---

## Assignment CB2: Update command execution route for sourceConfig

**File:** `src/app/api/ai/command/route.ts`

### Changes:

1. Add import at top:
```typescript
import { isSourceInput, getSourceConfig } from "@/lib/models/types";
```
(Replace the existing `import { isSourceInput } from "@/lib/models/types";`)

2. After the command is loaded (around line 90, after `if (!command)` check), extract source config:
```typescript
const sourceConfig = getSourceConfig(command);
```

3. Update the block reference resolution logic (around line 100-105). Currently:
```typescript
const resolvedInputs = await resolveBlockReferences(
  serviceClient,
  command,
  body.inputs,
  body.workspaceId
);
```

Change to:
```typescript
// When source_config exists and client sends explicit sources, skip legacy block reference resolution
const resolvedInputs = sourceConfig && body.sources.length > 0
  ? { ...body.inputs }
  : await resolveBlockReferences(serviceClient, command, body.inputs, body.workspaceId);
```

**Why:** When `sourceConfig` exists, the frontend sends sources via the `sources` array in the request body (already supported). The old `resolveBlockReferences` flow resolved source-type input values as block UUIDs — that's the legacy path for commands without sourceConfig. Both paths end up with resolved sources going through `resolveSources()`, which already works.

**Do NOT change** anything else in the route — prompt building, source resolution, streaming, tool handling all stay the same.

---

## Testing

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All must pass with 0 errors. Warnings are acceptable only if they are NOT in the files you modified.

### Manual verification:
1. Existing commands without `context_config.source` must work exactly as before (backward compatible)
2. The `getSourceConfig` helper returns `null` for commands without source config
3. When a command has `context_config: { source: { required: true, ... } }` and the request includes `sources: [...]`, `resolveBlockReferences` is skipped

---

## File structure after completion

```
src/
  lib/
    models/
      types.ts              ← CB1: SourceConfig interface + helper
  app/
    api/
      ai/
        command/route.ts     ← CB2: conditional block reference resolution
```
