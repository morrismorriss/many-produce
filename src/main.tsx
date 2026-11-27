import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { openExternal } from "./components/Support";
import "./styles/app.css";

// Links to the web or to email (shopping links, mailto:) open in the user's
// browser or mail app. The app window itself never navigates away.
document.addEventListener(
  "click",
  (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("blob:")) return;
    let url: URL;
    try { url = new URL(href, window.location.href); } catch { e.preventDefault(); return; }
    if (url.origin === window.location.origin) return;
    e.preventDefault();
    void openExternal(url.href).catch(() => undefined);
  },
  true,
);

/** A crash in one screen shows a message instead of a blank window. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="welcome">
        <h1 style={{ fontSize: 26 }}>Something went wrong</h1>
        <p className="muted">Your files are safe: nothing in your vault folder was changed by this error.</p>
        <pre className="draft-preview" style={{ textAlign: "left", maxWidth: "100%" }}>{String(this.state.error.message || this.state.error)}</pre>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload Many Produce</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
