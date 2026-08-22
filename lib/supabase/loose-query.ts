/**
 * Narrow structural view of a PostgREST row query.
 *
 * Supabase's type-level select/filter parser can exceed TypeScript's generic
 * instantiation depth on large views (TS2589). Cast a freshly-created builder
 * to this interface *before* composing a long dynamic query. Runtime behavior
 * remains the real PostgREST builder; only the recursive compile-time parser
 * is intentionally bypassed for these hot paths.
 */
export type LoosePostgrestError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type LooseRowsResult<Row> = {
  data: Row[] | null;
  error: LoosePostgrestError | null;
};

export interface LooseRowsQuery<Row> extends PromiseLike<LooseRowsResult<Row>> {
  select(columns?: string): LooseRowsQuery<Row>;
  eq(column: string, value: unknown): LooseRowsQuery<Row>;
  neq(column: string, value: unknown): LooseRowsQuery<Row>;
  not(column: string, operator: string, value: unknown): LooseRowsQuery<Row>;
  or(filters: string): LooseRowsQuery<Row>;
  ilike(column: string, pattern: string): LooseRowsQuery<Row>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): LooseRowsQuery<Row>;
  limit(count: number): LooseRowsQuery<Row>;
}

export function looseRowsQuery<Row>(builder: unknown): LooseRowsQuery<Row> {
  return builder as LooseRowsQuery<Row>;
}
