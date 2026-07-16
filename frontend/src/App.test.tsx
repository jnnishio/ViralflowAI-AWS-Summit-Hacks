import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { LanguageProvider } from './i18n'

function renderApp(initialPath: string) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('App routing', () => {
  it('redirects the root path to the upload screen', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { name: '上傳' })).toBeInTheDocument()
  })

  it('renders the upload screen at /upload', () => {
    renderApp('/upload')
    expect(screen.getByRole('heading', { name: '上傳' })).toBeInTheDocument()
  })

  it('falls back to the upload screen for unknown paths', () => {
    renderApp('/does-not-exist')
    expect(screen.getByRole('heading', { name: '上傳' })).toBeInTheDocument()
  })
})
