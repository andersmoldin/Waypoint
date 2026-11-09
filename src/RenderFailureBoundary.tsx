import React from "react";

/** Without this, React empties the whole page when something below it throws while rendering. */
export class RenderFailureBoundary extends React.Component<{ whenFailed: (reason: string) => React.ReactNode; children: React.ReactNode }, { reason: string | null }> {
  state: { reason: string | null } = { reason: null };

  static getDerivedStateFromError(error: Error) {
    return { reason: error.message };
  }

  render() {
    const { reason } = this.state;
    return reason === null ? this.props.children : this.props.whenFailed(reason);
  }
}
