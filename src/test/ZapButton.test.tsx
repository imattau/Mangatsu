import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const mockPayInvoice = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/nwc', () => ({
  NwcClient: function MockNwcClient() {
    return {
      blockUntilReady: vi.fn().mockResolvedValue(undefined),
      payInvoice: mockPayInvoice,
    }
  },
}))

// Mock fetch for LNURL flow
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock light-bolt11-decoder to return a valid amount matching 21 sats = 21000 msat
vi.mock('light-bolt11-decoder', () => ({
  decode: vi.fn().mockReturnValue({
    sections: [{ name: 'amount', value: 21000 }],
  }),
}))

describe('ZapButton', () => {
  beforeEach(() => {
    mockConnectionString = null
    mockFetchProfile.mockClear()
    mockPayInvoice.mockClear()
    mockFetch.mockReset()
    // Default fetch: lnurl metadata then invoice
    mockFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ callback: 'https://example.com/lnurlp/callback' }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ pr: 'lnbc210n1...' }),
      })
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

  it('shows confirmation dialog before paying', async () => {
    mockConnectionString = 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=abc'
    render(<ZapButton authorPubkey="abc123" />)
    fireEvent.click(screen.getByLabelText('Zap'))
    fireEvent.click(screen.getByText(/Zap 21 sats/i))

    await waitFor(() => {
      expect(screen.getByText(/Confirm Payment/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/21 sats/i)).toBeInTheDocument()
    expect(mockPayInvoice).not.toHaveBeenCalled()
  })

  it('pays invoice after user confirms', async () => {
    mockConnectionString = 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=abc'
    render(<ZapButton authorPubkey="abc123" />)
    fireEvent.click(screen.getByLabelText('Zap'))
    fireEvent.click(screen.getByText(/Zap 21 sats/i))

    await waitFor(() => {
      expect(screen.getByText(/Confirm Payment/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirm ⚡'))

    await waitFor(() => {
      expect(mockPayInvoice).toHaveBeenCalledWith('lnbc210n1...')
    })
  })

  it('cancels payment when user cancels confirmation', async () => {
    mockConnectionString = 'nostr+walletconnect://pubkey?relay=wss://relay.example&secret=abc'
    render(<ZapButton authorPubkey="abc123" />)
    fireEvent.click(screen.getByLabelText('Zap'))
    fireEvent.click(screen.getByText(/Zap 21 sats/i))

    await waitFor(() => {
      expect(screen.getByText(/Confirm Payment/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(screen.getByText(/Zap 21 sats/i)).toBeInTheDocument()
    })
    expect(mockPayInvoice).not.toHaveBeenCalled()
  })
})
