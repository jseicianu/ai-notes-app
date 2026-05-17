import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createCommand, updateCommand } from "@/services/command-service";

export const runtime = "nodejs";

const validationRuleSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional(),
});

const commandSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  promptTemplate: z.string().min(1),
  inputs: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      description: z.string().optional(),
      default_value: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      options: z.array(z.string()).optional(),
      input_mode: z.enum(["source", "text"]).optional(),
      validation: validationRuleSchema.optional(),
    })
  ),
  outputSchema: z.record(z.string(), z.unknown()).default({}),
  allowedTools: z.array(z.string()).default([]),
  contextConfig: z.record(z.string(), z.unknown()).default({}),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  sourceRunId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = commandSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", body.workspaceId)
    .eq("owner_id", user.id)
    .single();

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    );
  }

  try {
    const command = await createCommand({
      workspaceId: body.workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      promptTemplate: body.promptTemplate,
      inputs: body.inputs,
      outputSchema: body.outputSchema,
      allowedTools: body.allowedTools,
      contextConfig: body.contextConfig,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
      sourceRunId: body.sourceRunId,
    });

    return NextResponse.json(command, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create command";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing command id" }, { status: 400 });
  }

  const parsed = commandSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("commands")
    .select("id, workspace_id")
    .eq("id", id)
    .eq("workspace_id", body.workspaceId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", body.workspaceId)
    .eq("owner_id", user.id)
    .single();

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404 }
    );
  }

  try {
    const command = await updateCommand(id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      prompt_template: body.promptTemplate,
      inputs: body.inputs,
      output_schema: body.outputSchema,
      allowed_tools: body.allowedTools,
      context_config: body.contextConfig,
      model_provider: body.modelProvider,
      model_name: body.modelName,
      source_run_id: body.sourceRunId,
    });

    return NextResponse.json(command);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update command";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
