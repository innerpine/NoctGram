'use client';
import { Component } from 'react';
import { flip, type FlipMode } from '@/lib/layout-flip';

type Props = {
  /** A new value here is the layout change to animate. */
  watch: unknown;
  targets: () => Iterable<Element | null | undefined>;
  mode?: FlipMode;
  duration?: number;
  disabled?: boolean;
};
type Boxes = Map<HTMLElement, DOMRect> | null;

/**
 * Measures the targets right before React commits a new `watch` value, then
 * plays them from there into the new layout. The layout changes once; only
 * transforms animate. Renders nothing.
 */
export class LayoutFlip extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Boxes {
    if (Object.is(previous.watch, this.props.watch) || this.props.disabled)
      return null;
    const boxes = new Map<HTMLElement, DOMRect>();
    for (const element of this.props.targets())
      if (element instanceof HTMLElement)
        boxes.set(element, element.getBoundingClientRect());
    return boxes;
  }
  componentDidUpdate(_: Props, __: unknown, boxes: Boxes) {
    boxes?.forEach((box, element) =>
      flip(element, box, this.props.mode, this.props.duration),
    );
  }
  render() {
    return null;
  }
}
