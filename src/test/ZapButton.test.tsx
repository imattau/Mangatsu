import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZapButton } from '../components/ZapButton'

let mockConnectionString: string | null = null

vi.mock('../stores/nwcStore', () => ({
  useNwcStore: (sel: (s: { connectionString: string | null; setConnectionString: (s: string | null) => void }) => unknown) =>
    sel({ connectionString: mockConnectionString, setConnectionString: vi.fn() }),
}))

const mockFetchProfile = vi.fn().mockResolvedValue({ lud16: 'user@example.com', name: 'Test User' })

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({ service: { fetchProfile: mockFetchProfile } }),
}))

vi.mock('@nostr-dev-kit/ndk', () => ({
  default: vi.fn().mockImplementation(() => ({})),
  NDKNwc: vi.fn().mockImplementation(() => ({
    blockUntilReady: vi.fn().mockResolvedValue(undefined),
    payInvoice: vi.fn().mockResolvedValue(undefined),
  })),
}))

describe('ZapButton', () => {
  beforeEach(() => {
    mockConnectionString = null
    mockFetchProfile.mockClear()
  })

  it('renders the zap button', () => {
    render(<ZapButton authorPubkey="abc123" />)
    expect(screen.getByLabelText('Zap')).toBeInTheDocument()
  })

  it('shows amount picker on click when wallet is connected', () => {
    mockConnectionString = 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=abc'
    render(<ZapButton authorPubkey="abc123" />)
    fireEvent.click(screen.getByLabelText('Zap'))
    expect(screen.getByText('21')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('1000')).toBeInTheDocument()
  })

  it('shows connect wallet message when no NWC configured', () => {
    mockConnectionString = null
    render(<ZapButton authorPubkey="abc123" />)
    fireEvent.click(screen.getByLabelText('Zap'))
    expect(screen.getByText(/Connect a Lightning wallet/i)).toBeInTheDocument()
  })
})
