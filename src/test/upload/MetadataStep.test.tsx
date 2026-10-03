import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetadataStep, type MetadataFormValues } from '../../screens/Upload/MetadataStep'

vi.mock('../../context/NostrContext', () => ({
  useNostr: () => ({
    service: {
      eventStore: {},
      relayPool: { subscription: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) },
    },
    syncGeneration: 0,
  }),
}))

const EMPTY: MetadataFormValues = {
  title: '',
  authorName: '',
  authorPubkey: '',
  authorDisplayName: '',
  description: '',
  tags: '',
  language: '',
  coverFile: null,
  coverMode: 'file',
  nsfw: false,
}

function Harness({ onNext, initial = EMPTY }: { onNext: () => void; initial?: MetadataFormValues }) {
  const [values, setValues] = useState(initial)
  return <MetadataStep values={values} onChange={setValues} onNext={onNext} />
}

describe('MetadataStep', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('labels its fields', () => {
    render(<Harness onNext={vi.fn()} />)
    for (const name of [/title/i, /author name/i, /description/i, /tags/i, /language/i]) {
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('switch', { name: /mark as nsfw/i })).toBeInTheDocument()
  })

  it('submits with Enter once a title is entered', async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()
    render(<Harness onNext={onNext} />)

    await user.type(screen.getByRole('textbox', { name: /title/i }), '{Enter}')
    expect(onNext).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: /title/i }), 'Moonlit Archive{Enter}')
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('does not submit when Enter is pressed in the author search', async () => {
    const onNext = vi.fn()
    const user = userEvent.setup()
    render(<Harness onNext={onNext} initial={{ ...EMPTY, title: 'Has a title' }} />)

    await user.click(screen.getByRole('button', { name: /search by name/i }))
    await user.type(screen.getByRole('searchbox', { name: /author pubkey/i }), 'alice{Enter}')

    expect(onNext).not.toHaveBeenCalled()
  })

  it('keeps the cover file input reachable by keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness onNext={vi.fn()} />)

    const coverInput = screen.getByLabelText(/choose cover image/i)
    expect(coverInput).not.toHaveClass('hidden')
    coverInput.focus()
    expect(coverInput).toHaveFocus()

    await user.upload(coverInput, new File(['img'], 'cover.png', { type: 'image/png' }))
    expect(screen.getByText('cover.png')).toBeInTheDocument()
  })

  it('creates one preview URL per cover file, not one per keystroke', async () => {
    const createObjectURL = vi.fn(() => 'blob:cover')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const user = userEvent.setup()
    render(<Harness onNext={vi.fn()} />)

    await user.upload(screen.getByLabelText(/choose cover image/i), new File(['img'], 'cover.png', { type: 'image/png' }))
    await user.type(screen.getByRole('textbox', { name: /description/i }), 'typing a description')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(screen.getByAltText('Cover preview')).toHaveAttribute('src', 'blob:cover')
  })
})
