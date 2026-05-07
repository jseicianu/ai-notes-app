import type { Block, SuggestedInput } from "@/lib/models/types";

type JsonSchema = Record<string, unknown>;

export function generateSchemaFromOutput(
  outputBlocks: Block[],
  pageBlocks: Block[] = outputBlocks
): {
  inputs: SuggestedInput[];
  outputSchema: object;
  outputType: string;
} {
  const normalized = outputBlocks.map(normalizeBlockOutput);
  const outputTypes = Array.from(new Set(normalized.map((item) => item.type)));
  const outputType = outputTypes.length === 1 ? outputTypes[0] : "multiple";
  const schemas = normalized.map((item) => item.schema);
  const inputs = suggestInputsFromBlocks(pageBlocks);

  if (schemas.length === 0) {
    return {
      inputs,
      outputType: "multiple",
      outputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    };
  }

  if (schemas.length === 1) {
    return {
      inputs,
      outputType,
      outputSchema: schemas[0],
    };
  }

  return {
    inputs,
    outputType,
    outputSchema: {
      type: "object",
      properties: {
        outputs: {
          type: "array",
          items: { anyOf: schemas },
        },
      },
      required: ["outputs"],
      additionalProperties: false,
    },
  };
}

export function generateSchemaFromTable(
  columns: string[],
  rows: Record<string, unknown>[]
): object {
  const properties: Record<string, JsonSchema> = {};
  for (const column of columns) {
    properties[column] = inferColumnSchema(column, rows);
  }

  return {
    type: "object",
    properties: {
      columns: {
        type: "array",
        items: { type: "string" },
        default: columns,
      },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties,
          required: columns,
          additionalProperties: true,
        },
      },
    },
    required: ["columns", "rows"],
    additionalProperties: false,
  };
}

export function generateSchemaFromJson(data: unknown): object {
  return inferJsonSchema(data);
}

function normalizeBlockOutput(block: Block): { type: string; schema: JsonSchema } {
  if (block.type === "output") {
    const format = stringValue(block.content.format) || "text";
    if (format === "text") {
      return { type: "text", schema: textOutputSchema() };
    }

    if (format === "json") {
      return {
        type: "json",
        schema: inferJsonSchema(block.content.data),
      };
    }

    if (format === "table") {
      return {
        type: "table",
        schema: generateSchemaFromTable(
          arrayOfStrings(block.content.columns),
          arrayOfRecords(block.content.rows)
        ) as JsonSchema,
      };
    }
  }

  if (block.type === "table") {
    return {
      type: "table",
      schema: generateSchemaFromTable(
        arrayOfStrings(block.content.columns),
        arrayOfRecords(block.content.rows)
      ) as JsonSchema,
    };
  }

  if (block.type === "json") {
    return {
      type: "json",
      schema: inferJsonSchema(block.content.data),
    };
  }

  if (block.type === "todo") {
    return {
      type: "todo",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                done: { type: "boolean" },
              },
              required: ["text", "done"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    };
  }

  if (block.type === "bulleted_list" || block.type === "numbered_list") {
    return {
      type: block.type,
      schema: {
        type: "object",
        properties: {
          doc: { type: "string" },
        },
        required: ["doc"],
        additionalProperties: false,
      },
    };
  }

  if (block.type === "callout") {
    return {
      type: "callout",
      schema: {
        type: "object",
        properties: {
          type: { enum: ["info", "warning", "tip", "error"] },
          doc: { type: "string" },
        },
        required: ["type", "doc"],
        additionalProperties: false,
      },
    };
  }

  if (block.type === "separator") {
    return {
      type: "separator",
      schema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    };
  }

  if (block.type === "input") {
    return {
      type: "input",
      schema: inferJsonSchema(block.content.value),
    };
  }

  if (block.type === "source_card") {
    return {
      type: "source_card",
      schema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          summary: { type: "string" },
          scraped_at: { type: "string", format: "date-time" },
        },
        required: ["url", "title", "summary"],
        additionalProperties: false,
      },
    };
  }

  return {
    type: block.type,
    schema: inferJsonSchema(block.content),
  };
}

function inferColumnSchema(
  column: string,
  rows: Record<string, unknown>[]
): JsonSchema {
  const values = rows
    .map((row) => row[column])
    .filter((value) => value !== undefined && value !== null);

  if (values.length === 0) return { type: "string" };
  return mergeSchemas(values.map(inferJsonSchema));
}

function suggestInputsFromBlocks(blocks: Block[]): SuggestedInput[] {
  const seen = new Set<string>();
  const inputs: SuggestedInput[] = [];

  for (const block of blocks) {
    if (block.type !== "input") continue;

    const name = inputVariableName(block.content);
    if (!name || seen.has(name)) continue;

    seen.add(name);
    inputs.push({
      name,
      ...mapInputBlockToCommandInput(block),
      required: true,
      source: block.id,
    });
  }

  return inputs;
}

function mapInputBlockToCommandInput(block: Block): Omit<SuggestedInput, "name" | "required" | "source"> {
  const inputType = stringValue(block.content.input_type) || "text";
  const config = objectValue(block.content.config);

  if (inputType === "number") {
    return {
      type: "number",
      min: numberValue(config.min),
      max: numberValue(config.max),
      description: stringValue(block.content.label),
    };
  }

  if (inputType === "slider") {
    return {
      type: "number",
      min: numberValue(config.min),
      max: numberValue(config.max),
      description: stringValue(block.content.label),
    };
  }

  if (inputType === "checkbox") {
    return {
      type: "boolean",
      description: stringValue(block.content.label),
    };
  }

  if (inputType === "select") {
    return {
      type: "text",
      options: arrayOfOptionStrings(config.options),
      description: stringValue(block.content.label),
    };
  }

  return {
    type: "text",
    description: stringValue(block.content.label),
  };
}

function inferJsonSchema(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} };
    return {
      type: "array",
      items: mergeSchemas(value.map(inferJsonSchema)),
    };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties = Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, inferJsonSchema(child)])
    );

    return {
      type: "object",
      properties,
      required: Object.keys(record),
      additionalProperties: true,
    };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }

  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  const unique = Array.from(
    new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()
  );

  if (unique.length === 1) return unique[0];

  const primitiveTypes = unique
    .map((schema) => schema.type)
    .filter((type): type is string => typeof type === "string");

  if (primitiveTypes.length === unique.length) {
    return { type: Array.from(new Set(primitiveTypes)) };
  }

  return { anyOf: unique };
}

function textOutputSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      format: { const: "text" },
      data: { type: "string" },
    },
    required: ["format", "data"],
    additionalProperties: false,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inputVariableName(content: Record<string, unknown>) {
  const value = content.variable_name ?? content.variableName ?? content.name;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function arrayOfOptionStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value
    .map((option) => {
      if (typeof option === "string") return option;
      if (typeof option === "object" && option !== null) {
        const record = option as Record<string, unknown>;
        return stringValue(record.value) ?? stringValue(record.label);
      }

      return undefined;
    })
    .filter((option): option is string => Boolean(option));

  return options.length > 0 ? options : undefined;
}
