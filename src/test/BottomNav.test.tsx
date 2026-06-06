import { render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect } from 'vitest'
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
  beforeEach(() => {
  })

  it('renders only the non-active nav item on the Library route', () => {
    render(<Wrapper />)
    expect(screen.getByText('Feed')).toBeInTheDocument()
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })

  it('renders only the non-active nav item on the Feed route', () => {
    render(<Wrapper path="/feed" />)
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.queryByText('Feed')).not.toBeInTheDocument()
  })

  it('Library link points to / from the Feed route', () => {
    render(<Wrapper path="/feed" />)
    const libraryLink = screen.getByText('Library').closest('a')
    expect(libraryLink).toHaveAttribute('href', '/')
  })

  it('Feed link points to /feed from the Library route', () => {
    render(<Wrapper />)
    const feedLink = screen.getByText('Feed').closest('a')
    expect(feedLink).toHaveAttribute('href', '/feed')
  })

  it('does not render the active Library item on the Library route', () => {
    render(<Wrapper path="/" />)
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })
})
