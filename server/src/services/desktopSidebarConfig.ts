import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export type DesktopSidebarItemType = "builtin" | "template";

export interface DesktopSidebarItem {
  itemId: string;
  type: DesktopSidebarItemType;
  label: string;
  order: number;
  visible: boolean;
  iconAssetId?: string;
  target?: string;
  templateId?: string;
}

export interface DesktopSidebarConfig {
  version: 1;
  items: DesktopSidebarItem[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const BUILTIN_TARGET_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const TOP_LEVEL_KEYS = new Set(["version", "items"]);
const ITEM_KEYS = new Set([
  "itemId",
  "type",
  "label",
  "order",
  "visible",
  "iconAssetId",
  "target",
  "templateId",
]);

export function parseDesktopSidebarConfig(value: unknown): DesktopSidebarConfig {
  if (!isRecord(value) || Object.keys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) {
    invalid("侧栏配置必须是只包含 version 和 items 的对象");
  }
  if (value.version !== 1 || !Array.isArray(value.items) || value.items.length > 64) {
    invalid("侧栏配置版本无效或条目超过 64 个");
  }

  const itemIds = new Set<string>();
  const orders = new Set<number>();
  const items = value.items.map((item, index) => parseItem(item, index, itemIds, orders));
  return { version: 1, items: items.sort((left, right) => left.order - right.order) };
}

export function sidebarIconAssetIds(config: DesktopSidebarConfig): string[] {
  return [...new Set(config.items.flatMap((item) => (item.iconAssetId ? [item.iconAssetId] : [])))];
}

export function sidebarEtag(revision: bigint | number | string): string {
  return `"sidebar-${String(revision)}"`;
}

export function parseSidebarIfMatch(value: string | string[] | undefined): bigint {
  if (Array.isArray(value) || !value) {
    throw new AiDirectHiringError(
      ErrorCodes.PRECONDITION_REQUIRED,
      "写入侧栏配置必须提交 If-Match",
      428,
    );
  }
  const match = /^"sidebar-(0|[1-9][0-9]*)"$/.exec(value.trim());
  if (!match) {
    invalid('If-Match 格式必须为 "sidebar-<revision>"');
  }
  return BigInt(match[1]);
}

function parseItem(
  value: unknown,
  index: number,
  itemIds: Set<string>,
  orders: Set<number>,
): DesktopSidebarItem {
  if (!isRecord(value) || Object.keys(value).some((key) => !ITEM_KEYS.has(key))) {
    invalid(`items[${index}] 包含未知字段`);
  }
  if (typeof value.itemId !== "string" || !ITEM_ID_PATTERN.test(value.itemId)) {
    invalid(`items[${index}].itemId 不合法`);
  }
  if (itemIds.has(value.itemId)) {
    invalid(`itemId 重复：${value.itemId}`);
  }
  itemIds.add(value.itemId);

  if (value.type !== "builtin" && value.type !== "template") {
    invalid(`items[${index}].type 不受支持`);
  }
  if (
    typeof value.label !== "string" ||
    value.label.trim().length < 1 ||
    value.label.trim().length > 80 ||
    /[\u0000-\u001f\u007f]/.test(value.label)
  ) {
    invalid(`items[${index}].label 不合法`);
  }
  if (
    !Number.isInteger(value.order) ||
    (value.order as number) < 0 ||
    (value.order as number) >= 64
  ) {
    invalid(`items[${index}].order 必须是 0–63 的整数`);
  }
  if (orders.has(value.order as number)) {
    invalid(`order 重复：${String(value.order)}`);
  }
  orders.add(value.order as number);
  if (typeof value.visible !== "boolean") {
    invalid(`items[${index}].visible 必须是布尔值`);
  }
  if (
    value.iconAssetId !== undefined &&
    (typeof value.iconAssetId !== "string" || !UUID_PATTERN.test(value.iconAssetId))
  ) {
    invalid(`items[${index}].iconAssetId 不合法`);
  }

  if (value.type === "builtin") {
    if (typeof value.target !== "string" || !BUILTIN_TARGET_PATTERN.test(value.target)) {
      invalid(`items[${index}].target 不合法`);
    }
    if (value.templateId !== undefined) {
      invalid(`builtin 条目不能包含 templateId`);
    }
  } else {
    if (typeof value.templateId !== "string" || !UUID_PATTERN.test(value.templateId)) {
      invalid(`items[${index}].templateId 不合法`);
    }
    if (value.target !== undefined) {
      invalid(`template 条目不能包含 target`);
    }
  }

  return {
    itemId: value.itemId as string,
    type: value.type as DesktopSidebarItemType,
    label: (value.label as string).trim(),
    order: value.order as number,
    visible: value.visible as boolean,
    ...(value.iconAssetId ? { iconAssetId: value.iconAssetId as string } : {}),
    ...(value.target ? { target: value.target as string } : {}),
    ...(value.templateId ? { templateId: value.templateId as string } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, message, 400);
}
