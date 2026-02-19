"use client";

import React from "react";

type Props = { children: React.ReactNode };

type State = { hasError: boolean };

class GalleryErrorBoundaryClass extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Gallery error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="gallery-error-fallback" role="alert">
          <h2>Something went wrong</h2>
          <p>We couldn’t load the template gallery. Please refresh or try again.</p>
          <button
            type="button"
            className="editor-btn accent"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GalleryErrorBoundary({ children }: Props) {
  return <GalleryErrorBoundaryClass>{children}</GalleryErrorBoundaryClass>;
}
