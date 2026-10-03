import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QrCodeView } from '../screens/Login/QrCodeView'

const CONNECT_URI = 'nostrconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=s3cret'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

// Never resolves: keeps the view waiting for a signer, as it would before anyone scans.
vi.mock('applesauce-signers', () => ({
  PrivateKeySigner: class {},
  NostrConnectSigner: class {
    getNostrConnectURI() {
      return CONNECT_URI
    }
    open() {
      return new Promise(() => {})
    }
    close() {}
  },
}))
vi.mock('applesauce-accounts/accounts', () => ({ NostrConnectAccount: class {} }))
vi.mock('../context/NostrContext', () => ({ useNostr: () => ({ service: {} }) }))
vi.mock('../lib/remoteSigner', () => ({
  buildRemoteSignerRelays: () => ['wss://relay.example'],
  buildRemoteSignerPermissions: () => [],
  resolveConnectedSignerPubkey: vi.fn(),
}))

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

describe('QrCodeView', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('copies the nostrconnect link for signers on the same device', async () => {
    // userEvent.setup() installs its own clipboard stub, so replace it afterwards.
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    stubClipboard(writeText)
    render(<QrCodeView onSuccess={vi.fn()} onCancel={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /copy connection link/i }))

    expect(writeText).toHaveBeenCalledWith(CONNECT_URI)
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('explains when the link cannot be copied', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))))
    render(<QrCodeView onSuccess={vi.fn()} onCancel={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /copy connection link/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy the link/i)
  })
})
