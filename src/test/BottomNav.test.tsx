import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'

function Wrapper({ path = '/' }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <HeaderNav />
    </MemoryRouter>
  )
}

describe('HeaderNav', () => {
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
})
