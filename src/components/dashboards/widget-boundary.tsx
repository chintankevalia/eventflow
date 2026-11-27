"use client";

import * as React from "react";
import { WidgetRefusal } from "./widget-frame";

/**
 * Keeps one broken widget from taking the whole dashboard down.
 *
 * The engine already turns a bad *question* into a refusal rather than an exception, so this
 * catches the other half: a chart that throws while rendering — malformed data, a library
 * assumption that does not hold. Without it, React unmounts the entire page and a dashboard of
 * eight good widgets shows nothing because the ninth had a bad day.
 *
 * A class component because that is still the only way to catch a render error in React.
 */
export class WidgetBoundary extends React.Component<
  { title: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Logged in full, so a widget that fails for everyone is findable rather than merely
    // mysterious to whoever happened to open it.
    console.error(`Widget "${this.props.title}" failed to render`, error, info.componentStack);
  }

  /** A changed widget gets a fresh attempt rather than staying broken until a reload. */
  componentDidUpdate(previous: { title: string; children: React.ReactNode }) {
    if (this.state.failed && previous.children !== this.props.children) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <WidgetRefusal message="This widget could not be drawn. The rest of the dashboard is unaffected." />;
    }
    return this.props.children;
  }
}
