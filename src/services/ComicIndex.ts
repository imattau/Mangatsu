import { Index } from 'flexsearch'
import type { Comic } from '@/types'

const DB_NAME = 'mangatsu-comic-index'
const DB_VERSION = 1
const STORE_NAME = 'comics'

export interface ComicIndexQuery {
  limit?: number
  offset?: number
  tag?: string
  author?: string
  search?: string
  authors?: string[]
}

export interface ComicIndexResult {
  items: Comic[]
  hasMore: boolean
}

export interface AuthorDirectoryEntry {
  pubkey: string
  count: number
  latest: Comic
}

type ComicIndexRecord = Comic & {
  key: string
  resolvedAuthorPubkey: string
  searchText: string
  indexedAt: number
}

function comicKey(comic: Pick<Comic, 'pubkey' | 'dTag'>) {
  return `${comic.pubkey}:${comic.dTag}`
}

function resolveAuthorPubkey(comic: Pick<Comic, 'pubkey' | 'authorPubkey'>) {
  return comic.authorPubkey || comic.pubkey
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildSearchText(comic: Comic) {
  return normalizeSearch(
    [
      comic.title,
      comic.author,
      comic.authorPubkey,
      comic.pubkey,
      comic.dTag,
      comic.description,
      ...(comic.tags ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

function toRecord(comic: Comic): ComicIndexRecord {
  return {
    ...comic,
    key: comicKey(comic),
    resolvedAuthorPubkey: resolveAuthorPubkey(comic),
    searchText: buildSearchText(comic),
    indexedAt: comic.publishedAt ?? 0,
  }
}

function fromRecord(record: ComicIndexRecord): Comic {
  const { key: _key, resolvedAuthorPubkey: _resolvedAuthorPubkey, searchText: _searchText, indexedAt: _indexedAt, ...comic } = record
  return comic
}

function matchesStructuredQuery(record: ComicIndexRecord, query: ComicIndexQuery) {
  if (query.tag && !record.tags.includes(query.tag)) return false
  if (query.author && record.resolvedAuthorPubkey !== query.author) return false
  if (query.authors && query.authors.length > 0 && !query.authors.includes(record.resolvedAuthorPubkey)) {
    return false
  }

  return true
}

function sortByFreshness(a: Comic, b: Comic) {
  const aTime = a.publishedAt ?? 0
  const bTime = b.publishedAt ?? 0
  if (bTime !== aTime) return bTime - aTime
  return b.title.localeCompare(a.title)
}

class MemoryIndexBackend {
  private records = new Map<string, ComicIndexRecord>()

  snapshot() {
    return [...this.records.values()]
  }

  get(key: string) {
    return this.records.get(key) ?? null
  }

  async upsert(comic: Comic) {
    this.records.set(comicKey(comic), toRecord(comic))
  }

  async upsertMany(comics: Comic[]) {
    for (const comic of comics) {
      this.records.set(comicKey(comic), toRecord(comic))
    }
  }

  async remove(pubkey: string, dTag: string) {
    this.records.delete(`${pubkey}:${dTag}`)
  }

  async query(query: ComicIndexQuery): Promise<ComicIndexResult> {
    const offset = query.offset ?? 0
    const limit = query.limit ?? 60
    const items = [...this.records.values()]
      .filter((record) => matchesStructuredQuery(record, query))
      .sort((a, b) => sortByFreshness(fromRecord(a), fromRecord(b)))
      .slice(offset, offset + limit)
      .map(fromRecord)
    const total = [...this.records.values()].filter((record) => matchesStructuredQuery(record, query)).length
    return { items, hasMore: total > offset + items.length }
  }

  async listAuthors(query: ComicIndexQuery): Promise<AuthorDirectoryEntry[]> {
    const groups = new Map<string, AuthorDirectoryEntry>()
    for (const record of this.records.values()) {
      if (!matchesStructuredQuery(record, query)) continue
      const existing = groups.get(record.resolvedAuthorPubkey)
      const comic = fromRecord(record)
      if (!existing) {
        groups.set(record.resolvedAuthorPubkey, {
          pubkey: record.resolvedAuthorPubkey,
          count: 1,
          latest: comic,
        })
        continue
      }
      existing.count += 1
      if (sortByFreshness(comic, existing.latest) < 0) {
        existing.latest = comic
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.latest.title.localeCompare(b.latest.title)
    })
  }
}

export class ComicIndex {
  private version = 0
  private listeners = new Set<() => void>()
  private dbPromise: Promise<IDBDatabase | null> | null = null
  private readonly memory = new MemoryIndexBackend()
  private readonly searchIndex = new Index({ tokenize: 'forward', cache: true })
  private searchBootstrapped = false
  private searchBootstrapPromise: Promise<void> | null = null

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.version

  private emit() {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  private useMemoryBackend() {
    return typeof indexedDB === 'undefined'
  }

  private async loadAllRecords(): Promise<ComicIndexRecord[]> {
    const db = await this.openDb()
    if (!db) {
      return this.memory.snapshot()
    }

    return new Promise<ComicIndexRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('by_indexedAt').openCursor()
      const records: ComicIndexRecord[] = []

      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(records)
          return
        }
        records.push(cursor.value as ComicIndexRecord)
        cursor.continue()
      }
    })
  }

  private async ensureSearchIndex() {
    if (this.searchBootstrapped) return
    if (this.searchBootstrapPromise) {
      await this.searchBootstrapPromise
      return
    }

    this.searchBootstrapPromise = (async () => {
      if (this.useMemoryBackend()) {
        this.searchBootstrapped = true
        return
      }

      const records = await this.loadAllRecords()
      for (const record of records) {
        this.searchIndex.add(record.key, record.searchText)
      }
      this.searchBootstrapped = true
    })()

    try {
      await this.searchBootstrapPromise
    } finally {
      this.searchBootstrapPromise = null
    }
  }

  private async getRecordsByKeys(keys: Array<string | number>): Promise<ComicIndexRecord[]> {
    const keyStrings = keys.map((key) => String(key))
    const db = await this.openDb()
    if (!db) {
      return keyStrings.map((key) => this.memory.get(key)).filter(
        (record): record is ComicIndexRecord => Boolean(record),
      )
    }

    return Promise.all(
      keyStrings.map(
        (key) =>
          new Promise<ComicIndexRecord | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const request = tx.objectStore(STORE_NAME).get(key)

            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              resolve((request.result as ComicIndexRecord | undefined) ?? null)
            }
          }),
      ),
    ).then((records) => records.filter((record): record is ComicIndexRecord => Boolean(record)))
  }

  private async addToSearchIndex(record: ComicIndexRecord) {
    await this.ensureSearchIndex()
    this.searchIndex.add(record.key, record.searchText)
  }

  private async removeFromSearchIndex(key: string) {
    if (!this.searchBootstrapped) return
    this.searchIndex.remove(key)
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise
    if (this.useMemoryBackend()) {
      this.dbPromise = Promise.resolve(null)
      return this.dbPromise
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => {
        const db = request.result
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME)
        }
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('by_indexedAt', 'indexedAt')
        store.createIndex('by_authorPubkey', 'resolvedAuthorPubkey')
        store.createIndex('by_dTag', 'dTag')
        store.createIndex('by_tags', 'tags', { multiEntry: true })
      }
      request.onsuccess = () => resolve(request.result)
    })

    return this.dbPromise
  }

  async upsertComic(comic: Comic) {
    const record = toRecord(comic)
    const db = await this.openDb()
    if (!db) {
      await this.memory.upsert(comic)
      await this.addToSearchIndex(record)
      this.emit()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_NAME).put(record)
    })
    await this.addToSearchIndex(record)
    this.emit()
  }

  async upsertComics(comics: Comic[]) {
    if (comics.length === 0) return
    const db = await this.openDb()
    if (!db) {
      await this.memory.upsertMany(comics)
      await this.ensureSearchIndex()
      for (const comic of comics) {
        this.searchIndex.add(comicKey(comic), toRecord(comic).searchText)
      }
      this.emit()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      const store = tx.objectStore(STORE_NAME)
      for (const comic of comics) {
        store.put(toRecord(comic))
      }
    })
    await this.ensureSearchIndex()
    for (const comic of comics) {
      this.searchIndex.add(comicKey(comic), toRecord(comic).searchText)
    }
    this.emit()
  }

  async removeComic(pubkey: string, dTag: string) {
    const db = await this.openDb()
    if (!db) {
      await this.memory.remove(pubkey, dTag)
      await this.removeFromSearchIndex(`${pubkey}:${dTag}`)
      this.emit()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_NAME).delete(`${pubkey}:${dTag}`)
    })
    await this.removeFromSearchIndex(`${pubkey}:${dTag}`)
    this.emit()
  }

  async queryComics(query: ComicIndexQuery): Promise<ComicIndexResult> {
    const db = await this.openDb()
    if (!db) {
      const search = normalizeSearch(query.search ?? '')
      if (search.length === 0) {
        return this.memory.query(query)
      }
      await this.ensureSearchIndex()
      const ids = this.searchIndex.search(search) as Array<string | number>
      const records = await this.getRecordsByKeys(ids)
      const filtered = records.filter((record) => matchesStructuredQuery(record, query))
      const offset = query.offset ?? 0
      const limit = query.limit ?? 60
      return {
        items: filtered.slice(offset, offset + limit).map(fromRecord),
        hasMore: filtered.length > offset + limit,
      }
    }

    const search = normalizeSearch(query.search ?? '')
    if (search.length > 0) {
      await this.ensureSearchIndex()
      const ids = this.searchIndex.search(search) as Array<string | number>
      const records = await this.getRecordsByKeys(ids)
      const filtered = records.filter((record) => matchesStructuredQuery(record, query))
      const offset = query.offset ?? 0
      const limit = query.limit ?? 60
      return {
        items: filtered.slice(offset, offset + limit).map(fromRecord),
        hasMore: filtered.length > offset + limit,
      }
    }

    return new Promise<ComicIndexResult>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('by_indexedAt').openCursor(null, 'prev')

      const limit = query.limit ?? 60
      const offset = query.offset ?? 0
      const collected: Comic[] = []
      let matched = 0
      let hasMore = false

      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve({ items: collected, hasMore })
          return
        }

        const record = cursor.value as ComicIndexRecord
        if (matchesStructuredQuery(record, query)) {
          if (matched >= offset) {
            collected.push(fromRecord(record))
            if (collected.length >= limit) {
              hasMore = true
              resolve({ items: collected, hasMore })
              return
            }
          }
          matched += 1
        }

        cursor.continue()
      }
    })
  }

  async listAuthors(query: ComicIndexQuery): Promise<AuthorDirectoryEntry[]> {
    const db = await this.openDb()
    if (!db) {
      const search = normalizeSearch(query.search ?? '')
      if (search.length === 0) {
        return this.memory.listAuthors(query)
      }
      await this.ensureSearchIndex()
      const ids = this.searchIndex.search(search) as Array<string | number>
      const records = await this.getRecordsByKeys(ids)
      const groups = new Map<string, AuthorDirectoryEntry>()
      for (const record of records) {
        if (!matchesStructuredQuery(record, query)) continue
        const comic = fromRecord(record)
        const existing = groups.get(record.resolvedAuthorPubkey)
        if (!existing) {
          groups.set(record.resolvedAuthorPubkey, {
            pubkey: record.resolvedAuthorPubkey,
            count: 1,
            latest: comic,
          })
        } else {
          existing.count += 1
          if (sortByFreshness(comic, existing.latest) < 0) {
            existing.latest = comic
          }
        }
      }
      return [...groups.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return a.latest.title.localeCompare(b.latest.title)
      })
    }

    return new Promise<AuthorDirectoryEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('by_indexedAt').openCursor(null, 'prev')
      const groups = new Map<string, AuthorDirectoryEntry>()

      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(
            [...groups.values()].sort((a, b) => {
              if (b.count !== a.count) return b.count - a.count
              return a.latest.title.localeCompare(b.latest.title)
            }),
          )
          return
        }

        const record = cursor.value as ComicIndexRecord
        if (matchesStructuredQuery(record, query)) {
          const comic = fromRecord(record)
          const existing = groups.get(record.resolvedAuthorPubkey)
          if (!existing) {
            groups.set(record.resolvedAuthorPubkey, {
              pubkey: record.resolvedAuthorPubkey,
              count: 1,
              latest: comic,
            })
          } else {
            existing.count += 1
            if (sortByFreshness(comic, existing.latest) < 0) {
              existing.latest = comic
            }
          }
        }

        cursor.continue()
      }
    })
  }
}
