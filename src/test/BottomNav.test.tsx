import { render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'

const mockRefreshSync = vi.fn()
let mockIsRefreshing = false

vi.mock('../context/NostrContext', () => ({
  useNostr: () => ({ refreshSync: mockRefreshSync, isRefreshing: mockIsRefreshing }),
}))

function Wrapper({ path = '/' }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <HeaderNav />
    </MemoryRouter>
  )
}

describe('HeaderNav', () => {
  beforeEach(() => {
    mockIsRefreshing = false
    mockRefreshSync.mockClear()
  })

  it('renders a refresh button', () => {
    render(<Wrapper />)
    expect(screen.getByLabelText(/refresh relays/i)).toBeInTheDocument()
  })

  it('shows refreshing state', () => {
    mockIsRefreshing = true
    render(<Wrapper />)
    expect(screen.getByLabelText(/refreshing relays/i)).toBeInTheDocument()
    expect(screen.getByText(/refreshing/i)).toBeInTheDocument()
  })

  it('renders Library and Feed nav items', () => {
    render(<Wrapper />)
    // Labels are hidden on mobile but present in DOM
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Feed')).toBeInTheDocument()
  })

  it('Library link points to /', () => {
    render(<Wrapper />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink).toHaveAttribute('href', '/')
  })

  it('Feed link points to /feed', () => {
    render(<Wrapper />)
    const feedLink = screen.getByText('Feed').closest('a')
    expect(feedLink).toHaveAttribute('href', '/feed')
  })

  it('Library tab is active on / route', () => {
    render(<Wrapper path="/" />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink).toHaveClass('text-white')
  })

  it('Feed tab is active on /feed route', () => {
    render(<Wrapper path="/feed" />)
    const feedLink = screen.getByText('Feed').closest('a')
    expect(feedLink).toHaveClass('text-white')
  })

  it('invokes refresh on click', () => {
    render(<Wrapper />)
    screen.getByLabelText(/refresh relays/i).click()
    expect(mockRefreshSync).toHaveBeenCalledOnce()
  })
})
