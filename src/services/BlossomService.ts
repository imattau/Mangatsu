import { Actions } from 'blossom-client-sdk'
import type { SignedEvent } from 'blossom-client-sdk'

export interface BlossomSigner {
  signEvent(template: object): Promise<SignedEvent>
}

export class BlossomService {
  resolveUrl(hash: string, serverUrl: string): string {
    return `${serverUrl.replace(/\/$/, '')}/blob/${hash}`
  }

  async upload(file: File, serverUrl: string, signer: BlossomSigner): Promise<string> {
    const descriptor = await Actions.uploadBlob(serverUrl, file, {
      onAuth: async (server, sha256) => {
        const uploadUrl = `${server.replace(/\/$/, '')}/upload`
        const template = {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['u', uploadUrl],
            ['method', 'PUT'],
            ['payload', sha256],
          ],
          content: '',
        }
        return signer.signEvent(template)
      },
    })
    return descriptor.sha256
  }
}

export const blossomService = new BlossomService()
