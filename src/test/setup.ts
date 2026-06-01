import '@testing-library/jest-dom'

// Default no-op IntersectionObserver for tests that don't need it
if (typeof IntersectionObserver === 'undefined') {
  global.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
}
