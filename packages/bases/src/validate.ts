import { err, ok, type Result } from '@knowledge-studio/shared';
import type { BaseDefinition, BaseViewType, Filter } from './index.js';

/**
 * Runtime validation for Base definitions and inline field edits. Every
 * value crossing the renderer → main boundary is `unknown` until it passes
 * these checks; nothing here trusts TypeScript types alone.
 */

export type ValidationError = {
  readonly code: 'BASE_INVALID' | 'BASE_EDIT_INVALID';
  readonly message: string;
};

const VIEWS: readonly BaseViewType[] = ['table', 'card', 'kanban'];
const OPS: readonly Filter['op'][] = [
  'exists',
  'missing',
  'equals',
  'contains',
  'startsWith',
  'gt',
  'lt',
];
/** Property keys: letters (including Persian), digits, underscore, dash, space. */
const FIELD_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,63}$/u;
/** Virtual or identity fields that inline editing must never rewrite. */
const READ_ONLY_FIELDS = new Set(['id', 'path', 'modified']);
const MAX_FIELDS = 32;
const MAX_FILTERS = 32;
const MAX_TEXT = 2000;
const MAX_LIST = 64;

export function isSafeBaseId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
}

export function isFieldKey(key: unknown): key is string {
  return typeof key === 'string' && FIELD_KEY.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeFolder(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[a-zA-Z]:/.test(value) ||
    value.endsWith('/')
  )
    return false;
  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function fail(message: string): Result<never, ValidationError> {
  return err({ code: 'BASE_INVALID', message });
}

export function parseBaseDefinition(value: unknown): Result<BaseDefinition, ValidationError> {
  if (!isRecord(value)) return fail('Base definition must be an object');
  const { schemaVersion, id, name, view, folder, tags, filters, sort, fields, groupBy } = value;
  if (schemaVersion !== 1) return fail('Base schemaVersion must be 1');
  if (!isSafeBaseId(id)) return fail('Base ID is invalid');
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120)
    return fail('Base name must be 1-120 characters');
  if (typeof view !== 'string' || !VIEWS.includes(view as BaseViewType))
    return fail('Base view is invalid');
  if (folder !== undefined && !safeFolder(folder))
    return fail('Base folder must be a vault-relative folder');
  if (
    tags !== undefined &&
    (!Array.isArray(tags) ||
      tags.length > MAX_LIST ||
      !tags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 128))
  )
    return fail('Base tags are invalid');
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS)
    return fail('Base filters are invalid');
  const parsedFilters: Filter[] = [];
  for (const filter of filters) {
    if (
      !isRecord(filter) ||
      !isFieldKey(filter['field']) ||
      typeof filter['op'] !== 'string' ||
      !OPS.includes(filter['op'] as Filter['op'])
    )
      return fail('Base filter is invalid');
    const filterValue = filter['value'];
    if (
      filterValue !== undefined &&
      !(typeof filterValue === 'string' && filterValue.length <= MAX_TEXT) &&
      !(typeof filterValue === 'number' && Number.isFinite(filterValue))
    )
      return fail('Base filter value is invalid');
    parsedFilters.push({
      field: filter['field'],
      op: filter['op'] as Filter['op'],
      ...(filterValue !== undefined ? { value: filterValue } : {}),
    });
  }
  if (
    sort !== undefined &&
    (!isRecord(sort) ||
      !isFieldKey(sort['field']) ||
      (sort['direction'] !== 'asc' && sort['direction'] !== 'desc'))
  )
    return fail('Base sort is invalid');
  if (
    !Array.isArray(fields) ||
    fields.length > MAX_FIELDS ||
    !fields.every(isFieldKey) ||
    new Set(fields).size !== fields.length
  )
    return fail('Base fields are invalid');
  if (groupBy !== undefined && !isFieldKey(groupBy)) return fail('Base groupBy is invalid');
  if (view === 'kanban' && groupBy === undefined)
    return fail('Kanban bases require a groupBy field');
  return ok({
    schemaVersion: 1,
    id,
    name: name.trim(),
    view: view as BaseViewType,
    ...(folder !== undefined ? { folder } : {}),
    ...(tags !== undefined ? { tags: tags as string[] } : {}),
    filters: parsedFilters,
    ...(sort !== undefined
      ? { sort: { field: sort['field'] as string, direction: sort['direction'] as 'asc' | 'desc' } }
      : {}),
    fields: fields,
    ...(groupBy !== undefined ? { groupBy } : {}),
  });
}

export type FieldValue = string | number | boolean | null | readonly string[];
export interface FieldEdit {
  readonly path: string;
  readonly key: string;
  readonly value: FieldValue;
  readonly expectedMtimeMs: number;
}

/** Validates one inline metadata edit request from the renderer. */
export function parseFieldEdit(value: unknown): Result<FieldEdit, ValidationError> {
  const bad = (message: string): Result<never, ValidationError> =>
    err({ code: 'BASE_EDIT_INVALID', message });
  if (!isRecord(value)) return bad('Edit must be an object');
  const { path, key, expectedMtimeMs } = value;
  const fieldValue = value['value'];
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024 || !path.endsWith('.md'))
    return bad('Edit path must be a Markdown note');
  if (!isFieldKey(key) || READ_ONLY_FIELDS.has(key)) return bad('Field is not editable');
  if (
    typeof expectedMtimeMs !== 'number' ||
    !Number.isFinite(expectedMtimeMs) ||
    expectedMtimeMs < 0
  )
    return bad('Edit requires the row modification time');
  const validValue =
    fieldValue === null ||
    typeof fieldValue === 'boolean' ||
    (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) ||
    (typeof fieldValue === 'string' && fieldValue.length <= MAX_TEXT) ||
    (Array.isArray(fieldValue) &&
      fieldValue.length <= MAX_LIST &&
      fieldValue.every((item) => typeof item === 'string' && item.length <= 256));
  if (!validValue) return bad('Field value is invalid');
  return ok({ path, key, value: fieldValue as FieldValue, expectedMtimeMs });
}
