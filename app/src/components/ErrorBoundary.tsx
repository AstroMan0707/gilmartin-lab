import { Component, type ReactNode } from 'react'
import { Notice } from './Notice'

interface Props {
  children: ReactNode
  /** Puts back whatever made the view fail, e.g. the chart settings. */
  onReset: () => void
}

interface State {
  error: Error | null
}

/**
 * Keeps a render error in one tab from blanking the whole app.
 *
 * Without it, any exception while drawing — say from a malformed preset link — unmounted
 * everything, and with it the only way back to the loaded data. The data lives in the store,
 * outside this tree, so resetting the settings and rendering again recovers without reloading
 * any files.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  private reset = () => {
    this.props.onReset()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card">
        <Notice tone="error">
          This view could not be drawn: {this.state.error.message}. Your loaded data is unaffected.
        </Notice>
        <div className="row" style={{ marginTop: '0.875rem' }}>
          <button className="btn btn-primary" onClick={this.reset}>
            Reset chart settings
          </button>
        </div>
      </div>
    )
  }
}
