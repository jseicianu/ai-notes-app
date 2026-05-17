import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Command } from "@/lib/models/types";
import { createServiceRoleClient, createSseStream, requireWorkspace, serializeError } from "@/services/api-utils";
import { executeCommandTestCase, type CommandTestCase } from "@/services/command-test-runner";

export const runtime = "nodejs";

const paramsSchema = z.object({
  commandId: z.string().uuid(),
  testCaseId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ commandId: string; testCaseId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const supabase = await createClient();

  const { data: testCase, error: testError } = await supabase
    .from("test_cases")
    .select("*")
    .eq("id", params.data.testCaseId)
    .eq("command_id", params.data.commandId)
    .single();
  if (testError || !testCase) {
    return NextResponse.json(
      { error: testError?.message ?? "Test case not found" },
      { status: 404 }
    );
  }

  const auth = await requireWorkspace(request, testCase.workspace_id);
  if ("error" in auth) return auth.error;
  const serviceClient = createServiceRoleClient();

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

  return createSseStream(async (send) => {
    try {
      const result = await executeCommandTestCase({
        command: command as Command,
        testCase: testCase as CommandTestCase,
        workspace: auth.workspace,
        supabase: serviceClient,
        send,
      });
      send("complete", result);
    } catch (error) {
      send("error", serializeError(error));
    }
  });
}
