import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Command } from "@/lib/models/types";
import { createServiceRoleClient, createSseStream, requireWorkspace, serializeError } from "@/services/api-utils";
import { executeCommandTestCase, type CommandTestCase } from "@/services/command-test-runner";

export const runtime = "nodejs";

const paramsSchema = z.object({ commandId: z.string().uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ commandId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid command ID" }, { status: 400 });
  const supabase = await createClient();

  const { data: command, error: commandError } = await supabase
    .from("commands")
    .select("*")
    .eq("id", params.data.commandId)
    .single();
  if (commandError || !command) {
    return NextResponse.json(
      { error: commandError?.message ?? "Command not found" },
      { status: 404 }
    );
  }

  const auth = await requireWorkspace(request, command.workspace_id);
  if ("error" in auth) return auth.error;
  const serviceClient = createServiceRoleClient();

  const { data: cases, error: casesError } = await supabase
    .from("test_cases")
    .select("*")
    .eq("command_id", params.data.commandId)
    .order("created_at");
  if (casesError) {
    return NextResponse.json({ error: casesError.message }, { status: 400 });
  }

  return createSseStream(async (send) => {
    let passed = 0;
    let failed = 0;
    for (const testCase of cases ?? []) {
      send("test-start", { testCaseId: testCase.id, name: testCase.name });
      try {
        const result = await executeCommandTestCase({
          command: command as Command,
          testCase: testCase as CommandTestCase,
          workspace: auth.workspace,
          supabase: serviceClient,
          send,
        });
        if (result.status === "passed") passed += 1;
        else failed += 1;
        send("test-complete", result);
      } catch (error) {
        failed += 1;
        send("test-complete", { testCaseId: testCase.id, name: testCase.name, status: "failed", error: serializeError(error).message });
      }
    }
    send("summary", { total: cases?.length ?? 0, passed, failed });
  });
}
