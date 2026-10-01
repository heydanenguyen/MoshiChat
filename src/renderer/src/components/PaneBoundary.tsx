import { Component, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { translate } from '../i18n'
import { useStore } from '../store'

/**
 * One pane that failed to draw shows a quiet note with a way back instead of taking the whole window down to a blank
 * screen; the error goes to the log (renderer console errors are written to moshi.log by the main process).
 */
export class PaneBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error(`[${this.props.name}] failed to render:`, error.message, error.stack?.split('\n').slice(0, 4).join(' | '))
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const language = useStore.getState().settings.language
    return (
      <div className="pane-failed" role="alert">
        <span>{translate(language, 'paneFailed')}</span>
        <button className="btn small" onClick={() => this.setState({ failed: false })}>
          <RotateCcw size={13} strokeWidth={2.4} /> {translate(language, 'retry')}
        </button>
      </div>
    )
  }
}
