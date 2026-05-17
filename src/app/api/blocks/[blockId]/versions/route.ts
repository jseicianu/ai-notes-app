import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBlockVersions } from "@/services/block-version-service";

const paramsSchema = z.object({
  blockId: z.string().uuid(),
});

function summarizeVersionContent(type: string, content: Record<string, unknown> | null): string {
  if (!content) return type;
  switch (type) {
    case "table": {
      const cols = Array.isArray(content.columns) ? content.columns.length : 0;
      const rows = Array.isArray(content.rows) ? content.rows.length : 0;
      return `Table · ${cols} columns · ${rows} rows`;
    }
    case "output": {
      const data = typeof content.data === "string" ? content.data : "";
      return `Text · ${data.length} chars`;
    }
    case "json": {
      const data = content.data;
      const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).length : 0;
      return `JSON · ${keys} keys`;
    }
    case "todo": {
      const items = Array.isArray(content.items) ? content.items : [];
      const done = items.filter((i: Record<string, unknown>) => i.done).length;
      return `Todo · ${items.length} items · ${done} done`;
    }
    case "source_card": {
      const title = typeof content.title === "string" ? content.title : "Source";
      return `Source · ${title}`;
    }
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ blockId: string }> }
) {
  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid block ID" }, { status: 400 });
  }

  const versions = await getBlockVersions(parsed.data.blockId);

  return NextResponse.json({
    versions: versions.map((version) => {
      const content = version.content as Record<string, unknown> | null;
      return {
        version: version.version,
        type: version.type,
        created_at: version.created_at,
        summary: summarizeVersionContent(version.type, content),
      };
    }),
  });
}
