"use client";

import React from "react";
import Link from "next/link";

type Props = { children: React.ReactNode };

type State = { hasError: boolean; error?: Error };

class EditorErrorBoundaryClass extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("Editor error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-error-fallback" role="alert">
          <h2>Something went wrong</h2>
          <p>The editor couldn’t load or run properly. You can go back to the gallery or try again.</p>
          <div className="editor-error-fallback-actions">
            <Link href="/" className="editor-btn accent">
              Back to gallery
            </Link>
            <button
              type="button"
              className="editor-btn"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function EditorErrorBoundary({ children }: Props) {
  return <EditorErrorBoundaryClass>{children}</EditorErrorBoundaryClass>;
}
