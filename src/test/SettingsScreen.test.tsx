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
  useBlossomStore: (
    sel: (s: { servers: BlossomServer[]; setServers: (s: BlossomServer[]) => void }) => unknown,
  ) => sel({ servers: mockServers, setServers: mockSetServers }),
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
    mockClearAuth.mockClear()
    mockSetServers.mockClear()
    mockNavigate.mockClear()
  })

  it('renders truncated pubkey', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
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

  it('shows default relays', () => {
    render(<SettingsScreen />, { wrapper: Wrapper })
    expect(screen.getByText('wss://relay.damus.io')).toBeInTheDocument()
    expect(screen.getByText('wss://relay.primal.net')).toBeInTheDocument()
    expect(screen.getByText('wss://nos.lol')).toBeInTheDocument()
    expect(screen.getByText(/default relays/i)).toBeInTheDocument()
  })
})
