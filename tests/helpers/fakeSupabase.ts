// A small in-memory stand-in for the Supabase service-role client, enough for
// the partner program's and scan endpoints' API tests: from(table) with
// select / insert / upsert / update / delete, the filters those endpoints use (eq, neq, is, in, gte, lte, gt, lt,
// not … is), order, limit, single / maybeSingle and head counts; rpc();
// auth.getUser (staff sessions) and auth.admin.getUserById; and storage
// (signed photo and upload URLs, plus download/upload against state.files).
//
// It doesn't project columns (every select returns whole rows) and only knows
// the constraints (and generated columns) a test declares, so tests stay about
// the endpoint's logic.

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

export interface UniqueRule {
  columns: string[];
  /** Partial unique index: only rows matching this take part. */
  where?: (row: Row) => boolean;
}

export interface FakeState {
  tables: Record<string, Row[]>;
  /** Column defaults applied on insert, per table. */
  defaults: Record<string, Row | (() => Row)>;
  unique: Record<string, UniqueRule[]>;
  /**
   * Generated columns, per table: worked out from the row after every write,
   * and refused in a write the way Postgres refuses them (428C9).
   */
  generated: Record<string, Record<string, (row: Row) => unknown>>;
  /** One-shot error for the next query on a table. */
  failNext: Record<string, DbError | undefined>;
  rpc: Record<string, (args: Record<string, unknown>) => { data: unknown; error: DbError | null }>;
  /** Bearer token → user, for requireStaff. */
  sessions: Record<string, { id: string; email: string | null; app_metadata: Record<string, unknown> }>;
  /** auth.admin.getUserById */
  users: Record<string, { id: string; email: string | null }>;
  /** Every write, in order. */
  writes: { table: string; op: "insert" | "update" | "delete"; payload: unknown }[];
  /** Storage objects by path (any bucket), for download/upload. */
  files: Record<string, { data: Buffer; contentType?: string }>;
}

export function createFakeState(): FakeState {
  return { tables: {}, defaults: {}, unique: {}, generated: {}, failNext: {}, rpc: {}, sessions: {}, users: {}, writes: [], files: {} };
}

let idCounter = 0;
/** A fresh v4-shaped uuid (hex digits only, so the endpoints' UUID checks pass). */
export function fakeId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private payload: unknown = null;
  private filters: ((row: Row) => boolean)[] = [];
  private orderBy: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  // (nullsFirst defaults like Postgres: NULLS LAST ascending, NULLS FIRST descending.)
  private limitTo: number | null = null;
  private head = false;
  private wantCount = false;
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly state: FakeState,
    private readonly table: string,
  ) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.head = Boolean(opts?.head);
      this.wantCount = Boolean(opts?.count);
    } else {
      this.returning = true;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = rows;
    this.upsertOptions = options;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) >= 0);
    return this;
  }
  lte(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) <= 0);
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) > 0);
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((row) => row[column] != null && compare(row[column], value) < 0);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator === "in") {
      // PostgREST's list syntax: "(a,b,c)".
      const list = String(value).replace(/^\(|\)$/g, "").split(",").map((v) => v.trim());
      this.filters.push((row) => !list.includes(String(row[column])));
      return this;
    }
    if (operator !== "is") throw new Error(`fakeSupabase: not(${operator}) isn't supported`);
    this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  /**
   * PostgREST's or=(…) with eq, ilike, is (null, true, false) and lt/lte/gt/gte
   * conditions, e.g. "name.ilike.%sam%,email.ilike.%sam%" or
   * "checked_at.is.null,checked_at.lt.2026-10-25T20:00:00.000Z".
   */
  or(conditions: string) {
    const parts = conditions.split(",").map((part) => {
      const [column, op, ...rest] = part.split(".");
      return { column, op, value: rest.join(".") };
    });
    const like = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
    const literal = (value: string) => (value === "null" ? null : value === "true" ? true : value === "false" ? false : value);
    this.filters.push((row) =>
      parts.some(({ column, op, value }) => {
        const cell = row[column];
        if (op === "eq") return String(cell) === value;
        if (op === "ilike") return cell != null && like(value).test(String(cell));
        if (op === "is") return (cell ?? null) === literal(value);
        if (op === "lt") return cell != null && compare(cell, value) < 0;
        if (op === "lte") return cell != null && compare(cell, value) <= 0;
        if (op === "gt") return cell != null && compare(cell, value) > 0;
        if (op === "gte") return cell != null && compare(cell, value) >= 0;
        throw new Error(`fakeSupabase: or(${op}) isn't supported`);
      }),
    );
    return this;
  }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = opts?.ascending !== false;
    this.orderBy.push({ column, ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this.run();
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this.run();
  }
  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }

  private violatesUnique(candidate: Row, others: Row[]): boolean {
    for (const rule of this.state.unique[this.table] ?? []) {
      if (rule.where && !rule.where(candidate)) continue;
      if (rule.columns.some((c) => candidate[c] == null)) continue;
      const clash = others.some(
        (other) =>
          other !== candidate &&
          (!rule.where || rule.where(other)) &&
          rule.columns.every((c) => other[c] === candidate[c]),
      );
      if (clash) return true;
    }
    return false;
  }

  /** Postgres refuses a value for a generated column in any write. */
  private generatedColumnError(rows: Row[]): DbError | null {
    const generated = this.state.generated[this.table];
    if (!generated) return null;
    for (const row of rows) {
      const column = Object.keys(row).find((key) => key in generated && row[key] !== undefined);
      if (column) {
        return {
          code: "428C9",
          message:
            this.op === "update"
              ? `column "${column}" can only be updated to DEFAULT`
              : `cannot insert a non-DEFAULT value into column "${column}"`,
        };
      }
    }
    return null;
  }

  /** Works out the generated columns of rows being written. */
  private fillGenerated(rows: Row[]) {
    const generated = this.state.generated[this.table];
    if (!generated) return;
    for (const row of rows) {
      for (const [column, compute] of Object.entries(generated)) row[column] = compute(row);
    }
  }

  private async run(): Promise<Result> {
    const failure = this.state.failNext[this.table];
    if (failure) {
      delete this.state.failNext[this.table];
      return { data: null, error: failure, count: null };
    }
    const rows = (this.state.tables[this.table] ??= []);

    if (this.op === "insert" || this.op === "upsert" || this.op === "update") {
      const written = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const refused = this.generatedColumnError(written);
      if (refused) return { data: null, error: refused, count: null };
    }

    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const defaults = this.state.defaults[this.table];
      const created = list.map((row) => ({
        id: fakeId(),
        created_at: new Date().toISOString(),
        ...(typeof defaults === "function" ? defaults() : (defaults ?? {})),
        ...row,
      }));
      this.fillGenerated(created);
      for (const row of created) {
        if (this.violatesUnique(row, [...rows, ...created])) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
      }
      rows.push(...created);
      this.state.writes.push({ table: this.table, op: "insert", payload: this.payload });
      return this.shape(this.returning ? created : null);
    }

    if (this.op === "upsert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const keys = (this.upsertOptions.onConflict ?? "id").split(",").map((k) => k.trim());
      const touched: Row[] = [];
      for (const row of list) {
        const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
        if (existing) {
          if (this.upsertOptions.ignoreDuplicates) continue;
          Object.assign(existing, row);
          this.fillGenerated([existing]);
          this.state.writes.push({ table: this.table, op: "update", payload: row });
          touched.push(existing);
        } else {
          const created = { id: fakeId(), created_at: new Date().toISOString(), ...row };
          this.fillGenerated([created]);
          rows.push(created);
          this.state.writes.push({ table: this.table, op: "insert", payload: row });
          touched.push(created);
        }
      }
      return this.shape(this.returning ? touched : null);
    }

    const matched = rows.filter((row) => this.filters.every((f) => f(row)));

    if (this.op === "update") {
      const patch = this.payload as Row;
      for (const row of matched) {
        const next = { ...row, ...patch };
        this.fillGenerated([next]);
        // Compare against every other row (the row being updated doesn't clash with itself).
        if (this.violatesUnique(next, rows.filter((other) => other !== row))) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
      }
      for (const row of matched) Object.assign(row, patch);
      this.fillGenerated(matched);
      this.state.writes.push({ table: this.table, op: "update", payload: patch });
      return this.shape(this.returning ? matched : null);
    }

    if (this.op === "delete") {
      this.state.tables[this.table] = rows.filter((row) => !matched.includes(row));
      this.state.writes.push({ table: this.table, op: "delete", payload: null });
      return this.shape(this.returning ? matched : null);
    }

    if (this.head) return { data: null, error: null, count: matched.length };
    let out = [...matched];
    for (const { column, ascending, nullsFirst } of [...this.orderBy].reverse()) {
      out.sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av == null && bv == null) return 0;
        if (av == null) return nullsFirst ? -1 : 1;
        if (bv == null) return nullsFirst ? 1 : -1;
        return ascending ? compare(av, bv) : compare(bv, av);
      });
    }
    if (this.limitTo !== null) out = out.slice(0, this.limitTo);
    return this.shape(out, matched.length);
  }

  private shape(rows: Row[] | null, count?: number): Result {
    if (rows === null) return { data: null, error: null, count: null };
    const data = rows.map((row) => ({ ...row }));
    if (this.mode === "single") {
      if (data.length !== 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      }
      return { data: data[0], error: null };
    }
    if (this.mode === "maybeSingle") {
      if (data.length > 1) {
        return { data: null, error: { message: "JSON object requested, multiple rows returned", code: "PGRST116" } };
      }
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null, count: this.wantCount ? (count ?? data.length) : null };
  }
}

/** The client: pass it to vi.mock("../api/_lib/supabaseAdmin.js", …). */
export function createFakeSupabase(state: FakeState) {
  return {
    from: (table: string) => new Query(state, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      const fn = state.rpc[name];
      if (!fn) return { data: null, error: { message: `function ${name} does not exist` } };
      return fn(args);
    },
    auth: {
      getUser: async (token: string) => {
        const user = state.sessions[token];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
      admin: {
        getUserById: async (id: string) => ({ data: { user: state.users[id] ?? null }, error: null }),
      },
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
          error: null,
        }),
        // The objects directly under a folder (state.files), as storage lists them.
        list: async (prefix = "") => ({
          data: Object.entries(state.files)
            .filter(([path]) => prefix !== "" && path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes("/"))
            .map(([path, f]) => ({ id: path, name: path.slice(prefix.length + 1), metadata: { size: f.data.length, mimetype: f.contentType ?? "" } })),
          error: null,
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: { path, token: `token-${path}`, signedUrl: `https://upload.example/${path}` },
          error: null,
        }),
        download: async (path: string) => {
          const f = state.files[path];
          return f ? { data: new Blob([f.data]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        upload: async (path: string, data: Buffer, opts?: { contentType?: string }) => {
          state.files[path] = { data: Buffer.from(data), contentType: opts?.contentType };
          return { data: { path }, error: null };
        },
      }),
    },
  };
}

/** A minimal VercelResponse for handler tests. */
export function fakeResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
  };
  return res;
}
