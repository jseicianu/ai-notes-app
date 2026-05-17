import type { Block } from "@/lib/models/types";

export function blocksToMarkdown(blocks: Block[], pageTitle: string): string {
  const lines: string[] = [
    `# ${pageTitle}`,
    "",
    `<!-- Exported from Cell Notes on ${new Date().toISOString().split("T")[0]} -->`,
    "",
  ];

  for (const block of blocks) {
    const content = block.content ?? {};

    switch (block.type) {
      case "text":
        lines.push(tiptapToMarkdown(content.doc));
        break;
      case "heading":
        lines.push(`${"#".repeat(numberValue(content.level, 1))} ${stringValue(content.text) ?? tiptapToMarkdown(content.doc)}`);
        break;
      case "bulleted_list":
        for (const item of listItems(content)) lines.push(`- ${item}`);
        break;
      case "numbered_list":
        listItems(content).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
        break;
      case "todo":
        for (const item of arrayValue(content.items)) {
          const record = objectValue(item);
          lines.push(`- [${record.done ? "x" : " "}] ${stringValue(record.text) ?? ""}`);
        }
        break;
      case "table":
        lines.push(tableToMarkdown(stringArray(content.columns), rowsValue(content.rows)));
        break;
      case "json":
        lines.push("```json", JSON.stringify(content.data ?? content, null, 2), "```");
        break;
      case "output":
        lines.push(`> ${String(content.data ?? content.text ?? "").replace(/\n/g, "\n> ")}`);
        break;
      case "ai_cell":
        lines.push(`> **AI Cell:** ${content.prompt ?? ""}`);
        break;
      case "callout":
        lines.push(`> [!${content.type ?? "note"}]`, `> ${content.content ?? content.text ?? tiptapToMarkdown(content.doc)}`);
        break;
      case "source_card":
        lines.push(`[${content.title ?? content.url}](${content.url ?? ""})`);
        if (content.summary) lines.push(`> ${content.summary}`);
        break;
      case "separator":
        lines.push("---");
        break;
      case "file":
        lines.push(`File: ${content.filename ?? "unknown"}`);
        break;
      default:
        break;
    }

    lines.push("");
  }

  return lines.join("\n");
}

function tableToMarkdown(columns: string[], rows: Record<string, unknown>[]): string {
  if (!columns.length) return "";
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((row) => `| ${columns.map((col) => String(row[col] ?? "")).join(" | ")} |`);
  return [header, separator, ...dataRows].join("\n");
}

function tiptapToMarkdown(doc: unknown): string {
  if (!doc) return "";
  if (typeof doc === "string") return stripHtml(doc);
  if (typeof doc !== "object") return String(doc);

  const node = doc as Record<string, unknown>;
  const type = stringValue(node.type);
  const children = arrayValue(node.content);
  const childText = children.map(tiptapToMarkdown).join(type === "paragraph" ? "" : "\n");

  if (type === "text") return applyMarks(stringValue(node.text) ?? "", arrayValue(node.marks));
  if (type === "paragraph") return childText;
  if (type === "heading") return `${"#".repeat(numberValue(node.attrs && objectValue(node.attrs).level, 1))} ${childText}`;
  if (type === "bulletList") return children.map((child) => `- ${tiptapToMarkdown(child)}`).join("\n");
  if (type === "orderedList") return children.map((child, index) => `${index + 1}. ${tiptapToMarkdown(child)}`).join("\n");
  if (type === "listItem") return childText.replace(/\n/g, "\n  ");

  return childText;
}

function applyMarks(text: string, marks: unknown[]): string {
  return marks.reduce<string>((value, mark) => {
    const record = objectValue(mark);
    const type = stringValue(record.type);
    if (type === "bold") return `**${value}**`;
    if (type === "italic") return `*${value}*`;
    if (type === "code") return `\`${value}\``;
    if (type === "link") {
      const href = stringValue(objectValue(record.attrs).href) ?? "";
      return `[${value}](${href})`;
    }
    return value;
  }, text);
}

function listItems(content: Record<string, unknown>) {
  const doc = tiptapToMarkdown(content.doc);
  if (doc) return doc.split("\n").map((line) => line.replace(/^[-\d. ]+/, "")).filter(Boolean);
  return arrayValue(content.items).map((item) =>
    typeof item === "string" ? item : stringValue(objectValue(item).text) ?? ""
  ).filter(Boolean);
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function rowsValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    : [];
}
