import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LoginScreen } from '../screens/Login'
import { useAuthStore } from '../stores/authStore'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

vi.mock('../lib/sessionCrypto', () => ({
  initSession: vi.fn(async () => undefined),
  clearSession: vi.fn(),
}))

// The QR flow opens relay connections; it has its own component and isn't under test here.
vi.mock('../screens/Login/QrCodeView', () => ({
  QrCodeView: ({ onCancel }: { onCancel: () => void }) => (
    <button type="button" onClick={onCancel}>
      Cancel QR
    </button>
  ),
}))

vi.mock('nostr-passkey/applesauce', () => ({ hasPasskeyIdentityOnDevice: () => false }))

const TEST_PUBKEY = 'f'.repeat(64)
const mockFromKey = vi.fn((key: string) => {
  if (!key.startsWith('nsec1')) throw new Error('bad key')
  return { pubkey: TEST_PUBKEY }
})
vi.mock('applesauce-accounts/accounts', () => ({
  PrivateKeyAccount: { fromKey: (key: string) => mockFromKey(key) },
}))

const accountManager = {
  getAccountForPubkey: vi.fn(() => undefined),
  addAccount: vi.fn(),
  replaceAccount: vi.fn(),
  setActive: vi.fn(),
  clearActive: vi.fn(),
}
vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({ service: { accountManager } }),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  )
}

describe('LoginScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockFromKey.mockClear()
    Object.values(accountManager).forEach((fn) => fn.mockClear())
    useAuthStore.getState().clearAuth()
    sessionStorage.clear()
  })

  afterEach(() => {
    delete (window as Window & { nostr?: unknown }).nostr
  })

  it('offers the web login methods', () => {
    renderLogin()
    for (const name of [/browser extension/i, /paste nsec key/i, /bunker uri/i, /qr code/i, /passkey/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Signer apps (NIP-55) are Android-only.
    expect(screen.queryByRole('button', { name: /signer app/i })).not.toBeInTheDocument()
  })

  it('signs in with an nsec submitted with Enter', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))
    const input = screen.getByLabelText(/private key \(nsec\)/i)
    expect(input).toHaveFocus()
    await user.type(input, 'nsec1testkey{Enter}')

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
    expect(mockFromKey).toHaveBeenCalledWith('nsec1testkey')
    expect(accountManager.setActive).toHaveBeenCalledWith({ pubkey: TEST_PUBKEY })
    expect(useAuthStore.getState()).toMatchObject({ pubkey: TEST_PUBKEY, method: 'nsec' })
  })

  it('shows an error for an invalid nsec and stays on the page', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))
    await user.type(screen.getByLabelText(/private key \(nsec\)/i), 'not-a-key')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid nsec key/i)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(useAuthStore.getState().pubkey).toBeNull()
  })

  it('clears a typed key on cancel', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))
    await user.type(screen.getByLabelText(/private key \(nsec\)/i), 'nsec1secret')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))

    expect(screen.getByLabelText(/private key \(nsec\)/i)).toHaveValue('')
  })

  it('explains when no browser extension is installed', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /browser extension/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no extension detected/i)
  })

  it('shows the parse error for a malformed bunker URI', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /bunker uri/i }))
    await user.type(screen.getByRole('textbox', { name: /bunker uri/i }), 'not-a-bunker-uri{Enter}')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('clears the previous error when switching method', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /browser extension/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /bunker uri/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('forgets a typed key when switching to another method', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))
    await user.type(screen.getByLabelText(/private key \(nsec\)/i), 'nsec1secret')
    await user.click(screen.getByRole('button', { name: /bunker uri/i }))
    await user.click(screen.getByRole('button', { name: /paste nsec key/i }))

    expect(screen.getByLabelText(/private key \(nsec\)/i)).toHaveValue('')
  })
})
