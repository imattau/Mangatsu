import { Actions } from 'blossom-client-sdk'
import { createUploadAuth } from 'blossom-client-sdk/auth'
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
        return createUploadAuth(
          (draft) => signer.signEvent(draft),
          sha256,
          { servers: server },
        )
      },
    })
    return descriptor.sha256
  }
}

export const blossomService = new BlossomService()
