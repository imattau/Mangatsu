export class BlossomService {
  resolveUrl(hash: string, serverUrl: string): string {
    return `${serverUrl}/blob/${hash}`
  }

  async upload(_file: File, _serverUrl: string): Promise<string> {
    throw new Error('Not implemented')
  }
}

export const blossomService = new BlossomService()
