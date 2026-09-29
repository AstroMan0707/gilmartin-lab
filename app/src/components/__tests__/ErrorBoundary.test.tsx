import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

// React only runs `act` without warnings when told it is in a test environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  // React reports the caught error to the console; that is expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  container.remove()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows a way back instead of blanking the app, and recovers on reset', async () => {
    let broken = true
    const onReset = vi.fn(() => {
      broken = false
    })
    function View() {
      if (broken) throw new Error('bad bin spec')
      return <p>chart</p>
    }

    const root = createRoot(container)
    await act(async () => {
      root.render(
        <ErrorBoundary onReset={onReset}>
          <View />
        </ErrorBoundary>,
      )
    })
    expect(container.textContent).toContain('This view could not be drawn: bad bin spec')
    expect(container.textContent).toContain('Your loaded data is unaffected')

    await act(async () => {
      container.querySelector('button')!.click()
    })
    expect(onReset).toHaveBeenCalledOnce()
    expect(container.textContent).toBe('chart')
    await act(async () => root.unmount())
  })
})
