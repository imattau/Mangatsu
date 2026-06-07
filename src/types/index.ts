export interface Comic {
  id: string
  pubkey: string
  dTag: string
  publishedAt?: number
  title: string
  author: string
  authorPubkey: string
  description: string
  coverHash: string
  blossomServer: string
  coverServer?: string
  coverServers?: string[]
  coverTorrent?: string
  tags: string[]
  nsfw: boolean
  eventId: string
}

export interface PageDimensions {
  width: number
  height: number
}

export interface Chapter {
  id: string
  pubkey: string
  dTag: string
  parentDTag: string
  title: string
  pageHashes: string[]
  pageDimensions?: PageDimensions[]
  blossomServer: string
  pageServers?: string[]
  pageServerLists?: string[][]
  pageTorrents?: string[]
  publishedAt: number
  eventId: string
  torrent?: string
}

export interface ReadingProgress {
  id: string
  chapterDTag: string
  page: number
  updatedAt: number
}

export interface BlossomServer {
  url: string
}
