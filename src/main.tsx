import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>MediaVault hit an unexpected error</h1>
        <p>Reload the page to restore the application.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");
createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
