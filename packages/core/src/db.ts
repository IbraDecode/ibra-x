import { existsSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname } from "node:path"
import Database from "better-sqlite3"
import type { InboundMessage } from "@ibrax/sdk"

export interface StoredMessage {
  id: string
  accountId: string
  chatId: string
  senderId: string
  fromMe: boolean
  text: string
  timestamp: number
  mediaJson?: string
}

export interface MemoryRow {
  id: string
  scope: string
  scopeId?: string
  text: string
  tags: string[]
  source?: string
  /** Akun WhatsApp yang pertama mempelajari fakta ini. */
  accountId?: string
  /** Jejak lintas-nomor: siapa mempelajari kapan. */
  provenance: Array<{ accountId?: string; at: number }>
  createdAt: number
}

export interface OutboxRow {
  id: string
  accountId: string
  chatId: string
  payload: string
  state: "pending" | "sending" | "sent" | "failed" | "parked"
  attempts: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface InboxRow {
  id: string
  accountId: string
  payload: string
  state: "pending" | "processing" | "done"
  createdAt: number
  updatedAt: number
}

/**
 * Store SQLite untuk seluruh state runtime: akun, chat, pesan, sesi, memori,
 * antrean masuk/keluar, key-value, dan audit. Satu berkas, tanpa layanan
 * eksternal — sesuai prinsip "instalasi termudah".
 */
export class Store {
  readonly db: Database.Database

  constructor(path: string) {
    if (path !== ":memory:") {
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(path)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'hybrid',
        label TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'dm',
        name TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        from_me INTEGER NOT NULL DEFAULT 0,
        text TEXT,
        timestamp INTEGER NOT NULL,
        media_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        summary TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT,
        text TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source TEXT,
        account_id TEXT,
        provenance TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text, tags);

      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_state ON inbox(state, created_at);

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, created_at);

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        actor TEXT,
        action TEXT NOT NULL,
        detail TEXT
      );
    `)

    // Migrasi ringan: tambahkan kolom baru bila belum ada (untuk DB lama).
    this.ensureColumn("memory", "account_id", "TEXT")
    this.ensureColumn("memory", "provenance", "TEXT NOT NULL DEFAULT '[]'")
  }

  private ensureColumn(table: string, column: string, def: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
    }
  }

  // --- Akun ----------------------------------------------------------------
  upsertAccount(a: { id: string; role: string; label?: string | null; enabled?: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, role, label, enabled, created_at) VALUES (@id, @role, @label, @enabled, @now)
         ON CONFLICT(id) DO UPDATE SET role=@role, label=@label, enabled=@enabled`,
      )
      .run({ id: a.id, role: a.role, label: a.label ?? null, enabled: a.enabled === false ? 0 : 1, now: Date.now() })
  }

  listAccounts(): Array<{ id: string; role: string; label: string | null; enabled: number }> {
    return this.db.prepare("SELECT id, role, label, enabled FROM accounts ORDER BY id").all() as any
  }

  // --- Chat ----------------------------------------------------------------
  upsertChat(c: { id: string; accountId: string; kind: string; name?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO chats (id, account_id, kind, name, updated_at) VALUES (@id, @accountId, @kind, @name, @now)
         ON CONFLICT(id) DO UPDATE SET name=COALESCE(@name, name), updated_at=@now`,
      )
      .run({ id: c.id, accountId: c.accountId, kind: c.kind, name: c.name ?? null, now: Date.now() })
  }

  listChats(accountId?: string): Array<{ id: string; accountId: string; kind: string; name: string | null }> {
    const sql = accountId
      ? "SELECT id, account_id as accountId, kind, name FROM chats WHERE account_id=? ORDER BY updated_at DESC"
      : "SELECT id, account_id as accountId, kind, name FROM chats ORDER BY updated_at DESC"
    return (accountId ? this.db.prepare(sql).all(accountId) : this.db.prepare(sql).all()) as any
  }

  // --- Pesan ---------------------------------------------------------------
  /** Menyisipkan pesan secara idempoten (INSERT OR IGNORE). Mengembalikan true bila baru. */
  insertMessage(m: StoredMessage): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, account_id, chat_id, sender_id, from_me, text, timestamp, media_json)
         VALUES (@id, @accountId, @chatId, @senderId, @fromMe, @text, @timestamp, @mediaJson)`,
      )
      .run({ ...m, text: m.text ?? null, mediaJson: m.mediaJson ?? null, fromMe: m.fromMe ? 1 : 0 })
    return res.changes > 0
  }

  getHistory(chatId: string, limit = 50): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, account_id as accountId, chat_id as chatId, sender_id as senderId, from_me as fromMe,
                text, timestamp, media_json as mediaJson
         FROM messages WHERE chat_id=? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(chatId, limit) as any[]
    return rows.reverse().map((r) => ({ ...r, fromMe: !!r.fromMe }))
  }

  countMessages(): number {
    return (this.db.prepare("SELECT COUNT(*) as n FROM messages").get() as any).n
  }

  // --- Sesi ----------------------------------------------------------------
  getSessionSummary(sessionId: string): string | undefined {
    const row = this.db.prepare("SELECT summary FROM sessions WHERE id=?").get(sessionId) as any
    return row?.summary ?? undefined
  }

  setSessionSummary(sessionId: string, accountId: string, chatId: string, summary: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, account_id, chat_id, summary, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET summary=?, updated_at=?`,
      )
      .run(sessionId, accountId, chatId, summary, Date.now(), summary, Date.now())
  }

  // --- Memori --------------------------------------------------------------
  insertMemory(row: MemoryRow): void {
    const tags = row.tags.join(" ")
    const provenance = JSON.stringify(row.provenance ?? [])
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memory (id, scope, scope_id, text, tags, source, account_id, provenance, created_at)
           VALUES (@id, @scope, @scopeId, @text, @tags, @source, @accountId, @provenance, @createdAt)`,
        )
        .run({ ...row, accountId: row.accountId ?? null, tags, provenance })
      this.db.prepare("INSERT INTO memory_fts (id, text, tags) VALUES (?, ?, ?)").run(row.id, row.text, tags)
    })
    tx()
  }

  /** Mencari fakta yang sudah ada berdasarkan (scope, scopeId, text) untuk dedup. */
  findMemoryByText(scope: string, scopeId: string | undefined, text: string): MemoryRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, scope, scope_id as scopeId, text, tags, source, account_id as accountId, provenance, created_at as createdAt
         FROM memory WHERE scope=? AND IFNULL(scope_id,'')=IFNULL(?,'') AND text=? LIMIT 1`,
      )
      .get(scope, scopeId ?? null, text) as any
    return row ? mapMemory(row) : undefined
  }

  /** Menambahkan jejak (provenance) ke sebuah fakta yang dipelajari ulang. */
  appendMemoryProvenance(id: string, entry: { accountId?: string; at: number }): void {
    const row = this.db.prepare("SELECT provenance FROM memory WHERE id=?").get(id) as any
    if (!row) return
    const prov = safeParseArray(row.provenance)
    prov.push(entry)
    this.db.prepare("UPDATE memory SET provenance=? WHERE id=?").run(JSON.stringify(prov), id)
  }

  allMemory(limit = 10_000): MemoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope, scope_id as scopeId, text, tags, source, account_id as accountId, provenance, created_at as createdAt
         FROM memory ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as any[]
    return rows.map(mapMemory)
  }

  /** Hash stabil atas isi memori (urutan id deterministik) untuk deteksi perubahan/tamper. */
  memoryFingerprint(): string {
    const rows = this.db
      .prepare("SELECT id, text, tags FROM memory ORDER BY id")
      .all() as Array<{ id: string; text: string; tags: string }>
    const hash = createHash("sha256")
    for (const r of rows) hash.update(`${r.id}\u0000${r.text}\u0000${r.tags}\n`)
    return hash.digest("hex")
  }

  searchMemory(
    query: string,
    opts: { scope?: string; scopeId?: string; limit?: number } = {},
  ): MemoryRow[] {
    const limit = opts.limit ?? 20
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.scope) {
      conditions.push("m.scope = ?")
      params.push(opts.scope)
    }
    if (opts.scopeId) {
      conditions.push("m.scope_id = ?")
      params.push(opts.scopeId)
    }
    const extra = conditions.length ? `AND ${conditions.join(" AND ")}` : ""
    const cols = "m.id, m.scope, m.scope_id as scopeId, m.text, m.tags, m.source, m.account_id as accountId, m.provenance, m.created_at as createdAt"
    let rows: any[]
    try {
      rows = this.db
        .prepare(
          `SELECT ${cols} FROM memory_fts f JOIN memory m ON m.id = f.id WHERE memory_fts MATCH ? ${extra} ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery(query), ...params, limit) as any[]
    } catch {
      // Query FTS tidak valid → fallback ke LIKE.
      rows = this.db
        .prepare(`SELECT ${cols} FROM memory m WHERE m.text LIKE ? ${extra} ORDER BY m.created_at DESC LIMIT ?`)
        .all(`%${query}%`, ...params, limit) as any[]
    }
    return rows.map(mapMemory)
  }

  getMemory(id: string): MemoryRow | undefined {
    const r = this.db
      .prepare(
        `SELECT id, scope, scope_id as scopeId, text, tags, source, account_id as accountId, provenance, created_at as createdAt
         FROM memory WHERE id=?`,
      )
      .get(id) as any
    return r ? mapMemory(r) : undefined
  }

  deleteMemory(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM memory WHERE id=?").run(id)
      this.db.prepare("DELETE FROM memory_fts WHERE id=?").run(id)
    })
    tx()
  }

  countMemory(): number {
    return (this.db.prepare("SELECT COUNT(*) as n FROM memory").get() as any).n
  }

  // --- Inbox (masuk, idempoten) -------------------------------------------
  /** Mengembalikan true bila pesan baru (belum pernah masuk). */
  enqueueInbox(accountId: string, msg: InboundMessage): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO inbox (id, account_id, payload, state, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(msg.id, accountId, JSON.stringify(msg), Date.now(), Date.now())
    return res.changes > 0
  }

  takePendingInbox(limit = 20): InboxRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM inbox WHERE state='pending' ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as any[]
    return rows.map(mapInbox)
  }

  /** Apakah masih ada pesan pending di antrean masuk. */
  hasPendingInbox(): boolean {
    const row = this.db.prepare(`SELECT 1 AS x FROM inbox WHERE state='pending' LIMIT 1`).get() as any
    return Boolean(row)
  }

  setInboxState(id: string, state: InboxRow["state"]): void {
    this.db.prepare("UPDATE inbox SET state=?, updated_at=? WHERE id=?").run(state, Date.now(), id)
  }

  // --- Outbox --------------------------------------------------------------
  enqueueOutbox(row: { id: string; accountId: string; chatId: string; payload: unknown }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox (id, account_id, chat_id, payload, state, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(row.id, row.accountId, row.chatId, JSON.stringify(row.payload), Date.now(), Date.now())
  }

  listOutbox(state?: OutboxRow["state"]): OutboxRow[] {
    const sql = state
      ? "SELECT * FROM outbox WHERE state=? ORDER BY created_at ASC"
      : "SELECT * FROM outbox ORDER BY created_at ASC"
    const rows = (state ? this.db.prepare(sql).all(state) : this.db.prepare(sql).all()) as any[]
    return rows.map(mapOutbox)
  }

  updateOutbox(
    id: string,
    patch: { state?: OutboxRow["state"]; attempts?: number; lastError?: string | null },
  ): void {
    const cur = this.db.prepare("SELECT attempts FROM outbox WHERE id=?").get(id) as any
    if (!cur) return
    const attempts = patch.attempts ?? cur.attempts
    this.db
      .prepare("UPDATE outbox SET state=COALESCE(?, state), attempts=?, last_error=?, updated_at=? WHERE id=?")
      .run(patch.state ?? null, attempts, patch.lastError ?? null, Date.now(), id)
  }

  // --- KV ------------------------------------------------------------------
  kvGet<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as any
    if (!row) return undefined
    try {
      return JSON.parse(row.value) as T
    } catch {
      return undefined
    }
  }

  kvSet(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?")
      .run(key, JSON.stringify(value), JSON.stringify(value))
  }

  kvDelete(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key=?").run(key)
  }

  kvList(prefix = ""): Array<{ key: string; value: unknown }> {
    const rows = this.db
      .prepare("SELECT key, value FROM kv WHERE key LIKE ? ORDER BY key")
      .all(`${prefix}%`) as any[]
    return rows.map((r) => {
      try {
        return { key: r.key, value: JSON.parse(r.value) }
      } catch {
        return { key: r.key, value: r.value }
      }
    })
  }

  // --- Audit ---------------------------------------------------------------
  audit(entry: { actor?: string; action: string; detail?: unknown }): void {
    this.db
      .prepare("INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)")
      .run(Date.now(), entry.actor ?? null, entry.action, entry.detail === undefined ? null : JSON.stringify(entry.detail))
  }

  listAudit(limit = 100): Array<{ id: number; ts: number; actor: string | null; action: string; detail: string | null }> {
    return this.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(limit) as any
  }

  close(): void {
    this.db.close()
  }
}

function mapInbox(r: any): InboxRow {
  return {
    id: r.id,
    accountId: r.account_id,
    payload: r.payload,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapOutbox(r: any): OutboxRow {
  return {
    id: r.id,
    accountId: r.account_id,
    chatId: r.chat_id,
    payload: r.payload,
    state: r.state,
    attempts: r.attempts,
    lastError: r.last_error ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Mengubah kueri pengguna menjadi kueri FTS5 yang aman (prefix match per kata). */
export function ftsQuery(input: string): string {
  const terms = input
    .replace(/["*()]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (!terms.length) return '""'
  return terms.map((t) => `"${t}"*`).join(" ")
}

function safeParseArray(value: unknown): Array<{ accountId?: string; at: number }> {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapMemory(r: any): MemoryRow {
  return {
    id: r.id,
    scope: r.scope,
    scopeId: r.scopeId ?? undefined,
    text: r.text,
    tags: r.tags ? String(r.tags).split(/\s+/).filter(Boolean) : [],
    source: r.source ?? undefined,
    accountId: r.accountId ?? undefined,
    provenance: safeParseArray(r.provenance),
    createdAt: r.createdAt,
  }
}
