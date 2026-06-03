import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsScreen } from '../screens/Settings'
import type { BlossomServer } from '../types'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

let mockPubkey: string | null = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
const mockClearAuth = vi.fn()

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubkey: string | null; clearAuth: () => void }) => unknown) =>
    sel({ pubkey: mockPubkey, clearAuth: mockClearAuth }),
}))

let mockServers: BlossomServer[] = []
const mockSetServers = vi.fn((servers: BlossomServer[]) => {
  mockServers = servers
})

vi.mock('../stores/blossomStore', () => ({
  DEFAULT_BLOSSOM_SERVERS: [
    'https://blossom.primal.net',
    'https://blossom.band',
    'https://cdn.satellite.earth',
  ],
  useBlossomStore: (
    sel: (s: { servers: BlossomServer[]; setServers: (s: BlossomServer[]) => void }) => unknown,
  ) => sel({ servers: mockServers, setServers: mockSetServers }),
}))

const mockPublishBlossomServerList = vi.fn().mockResolvedValue(undefined)

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({ service: { publishBlossomServerList: mockPublishBlossomServerList } }),
}))

let mockNwcConnectionString: string | null = null
const mockSetConnectionString = vi.fn((s: string | null) => { mockNwcConnectionString = s })

vi.mock('../stores/nwcStore', () => ({
  useNwcStore: (sel: (s: { connectionString: string | null; setConnectionString: (s: string | null) => void }) => unknown) =>
    sel({ connectionString: mockNwcConnectionString, setConnectionString: mockSetConnectionString }),
}))

vi.mock('../stores/relayStore', () => ({
  DEFAULT_RELAYS: [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://purplepag.es',
  ],
  useRelayStore: (sel: (s: { relays: string[]; activeRelays: () => string[] }) => unknown) =>
    sel({ relays: [], activeRelays: () => ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://purplepag.es'] }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={children} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockPubkey = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    mockServers = []
    mockNwcConnectionString = null
    mockClearAuth.mockClear()
    mockSetServers.mockClear()
    mockNavigate.mockClear()
    mockPublishBlossomServerList.mockClear()
    mockSetConnectionString.mockClear()
  })

  it('renders truncated pubkey', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    const el = screen.getByTestId('pubkey')
    expect(el.textContent).toContain('abcdef12')
    expect(el.textContent).toContain('67890')
    // should not show full key
    expect(el.textContent).not.toBe(mockPubkey)
  })

  it('sign out clears auth and navigates to /login', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    fireEvent.click(screen.getByText('Sign out'))
    expect(mockClearAuth).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('can add a blossom server', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    const input = screen.getByPlaceholderText('https://blossom.example')
    fireEvent.change(input, { target: { value: 'https://new.server' } })
    fireEvent.click(screen.getByText('Add'))
    expect(mockSetServers).toHaveBeenCalledWith([{ url: 'https://new.server' }])
  })

  it('can remove a blossom server', () => {
    mockServers = [{ url: 'https://server-a.example' }, { url: 'https://server-b.example' }]
    render(<SettingsScreen />, { wrapper: Wrapper })
    const removeBtn = screen.getByLabelText('Remove https://server-a.example')
    fireEvent.click(removeBtn)
    expect(mockSetServers).toHaveBeenCalledWith([{ url: 'https://server-b.example' }])
  })

  it('publishes kind 10063 when a server is added', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    const input = screen.getByPlaceholderText('https://blossom.example')
    fireEvent.change(input, { target: { value: 'https://new.server' } })
    fireEvent.click(screen.getByText('Add'))
    expect(mockPublishBlossomServerList).toHaveBeenCalledWith(['https://new.server'])
  })

  it('publishes kind 10063 when a server is removed', () => {
    mockServers = [{ url: 'https://server-a.example' }, { url: 'https://server-b.example' }]
    render(<SettingsScreen />, { wrapper: Wrapper })
    const removeBtn = screen.getByLabelText('Remove https://server-a.example')
    fireEvent.click(removeBtn)
    expect(mockPublishBlossomServerList).toHaveBeenCalledWith(['https://server-b.example'])
  })

  it('shows default relays', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByText('wss://relay.damus.io')).toBeInTheDocument()
    expect(screen.getByText('wss://relay.primal.net')).toBeInTheDocument()
    expect(screen.getByText('wss://nos.lol')).toBeInTheDocument()
    expect(screen.getByText(/using public defaults/i)).toBeInTheDocument()
  })

  it('renders NWC section', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('nwc-section')).toBeInTheDocument()
    expect(screen.getByText(/Wallet \(NWC\)/i)).toBeInTheDocument()
  })

  it('shows NWC input when not connected', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('nwc-input')).toBeInTheDocument()
  })

  it('saves NWC connection string', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    const input = screen.getByTestId('nwc-input')
    fireEvent.change(input, { target: { value: 'nostr+walletconnect://pubkey?relay=wss://r.example&secret=abc' } })
    fireEvent.click(screen.getByText('Save'))
    expect(mockSetConnectionString).toHaveBeenCalledWith('nostr+walletconnect://pubkey?relay=wss://r.example&secret=abc')
  })

  it('shows disconnect button when NWC is connected', () => {
    mockNwcConnectionString = 'nostr+walletconnect://pubkey?relay=wss://r.example&secret=abc'
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByText('Disconnect')).toBeInTheDocument()
  })
})
