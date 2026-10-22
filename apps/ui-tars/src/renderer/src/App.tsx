import { Component, type ReactNode } from 'react';
import AssistantPanel from './components/Assistant/AssistantPanel';
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    void window.electron.assistant.cancel().catch(() => {});
  }
  render() {
    if (this.state.error)
      return (
        <div
          style={{
            padding: 30,
            color: '#e8edf5',
            background: '#111318',
            height: '100vh',
            fontFamily: 'system-ui',
          }}
        >
          <h2>The panel needs to restart.</h2>
          <p>Active requests were cancelled.</p>
          <button onClick={() => location.reload()}>Reload panel</button>
        </div>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <AssistantPanel />
    </ErrorBoundary>
  );
}
