import type { Block } from "@/lib/models/types";

const PARENT_BLOCK_TYPES = new Set(["ai_cell", "command_ref"]);

export function getDisplayBlocks(blocks: Block[]): Block[] {
  const parentIds = new Set(
    blocks.filter((block) => PARENT_BLOCK_TYPES.has(block.type)).map((block) => block.id)
  );
  const childBlockMap = new Map<string, Block[]>();

  for (const block of blocks) {
    if (block.parent_block_id && parentIds.has(block.parent_block_id)) {
      const existing = childBlockMap.get(block.parent_block_id) ?? [];
      existing.push(block);
      childBlockMap.set(block.parent_block_id, existing);
    }
  }

  const childBlockIds = new Set(
    Array.from(childBlockMap.values()).flat().map((block) => block.id)
  );
  const ordered: Block[] = [];

  for (const block of blocks) {
    if (childBlockIds.has(block.id)) continue;
    ordered.push(block);
    if (PARENT_BLOCK_TYPES.has(block.type)) {
      ordered.push(...(childBlockMap.get(block.id) ?? []));
    }
  }

  return ordered;
}

export function getChildBlocksOwnedByParents(blocks: Block[]): Set<string> {
  const parentIds = new Set(
    blocks.filter((block) => PARENT_BLOCK_TYPES.has(block.type)).map((block) => block.id)
  );
  return new Set(
    blocks
      .filter((block) => block.parent_block_id && parentIds.has(block.parent_block_id))
      .map((block) => block.id)
  );
}

export function getBlockNumberMap(blocks: Block[]): Map<string, number> {
  return new Map(
    getDisplayBlocks(blocks).map((block, index) => [block.id, index + 1])
  );
}
