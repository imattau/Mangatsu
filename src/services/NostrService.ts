import { EventStore } from 'applesauce-core'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { EventFactory } from 'applesauce-factory'

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

export class NostrService {
  eventStore = new EventStore()
  relayPool = new RelayPool()
  accountManager = new AccountManager()
  eventFactory = new EventFactory()

  async connect(relays: string[] = DEFAULT_RELAYS) {
    for (const url of relays) {
      this.relayPool.relay(url)
    }
  }

  async disconnect() {
    for (const [, relay] of this.relayPool.relays) {
      relay.close()
    }
  }

  get activeAccount() {
    return this.accountManager.active
  }
}

export const nostrService = new NostrService()
