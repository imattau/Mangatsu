export interface Comic {
  id: string
  pubkey: string
  dTag: string
  title: string
  author: string
  authorPubkey: string
  description: string
  coverHash: string
  blossomServer: string
  coverServer?: string
  coverServers?: string[]
  tags: string[]
  nsfw: boolean
  eventId: string
}

export interface Chapter {
  id: string
  pubkey: string
  dTag: string
  parentDTag: string
  title: string
  pageHashes: string[]
  blossomServer: string
  pageServers?: string[]
  pageServerLists?: string[][]
  publishedAt: number
  eventId: string
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
