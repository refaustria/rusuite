// react-konva needs a real <canvas> (the native `canvas` package under
// jsdom); tests replace its components with plain elements that expose
// a few props as data attributes.

import React from "react";

const el = (kind: string) =>
  React.forwardRef<unknown, Record<string, unknown>>(function Mock(props, _ref) {
    const { children, text, width, height, draggable, shapeId, fill } = props as {
      children?: React.ReactNode;
      text?: string;
      width?: number;
      height?: number;
      draggable?: boolean;
      shapeId?: number;
      fill?: string;
    };
    return React.createElement(
      "div",
      {
        "data-konva": kind,
        "data-width": width,
        "data-height": height,
        "data-draggable": String(!!draggable),
        "data-shape-id": shapeId,
        "data-fill": typeof fill === "string" ? fill : undefined,
      },
      text,
      children as React.ReactNode,
    );
  });

export const Stage = el("Stage");
export const Layer = el("Layer");
export const Group = el("Group");
export const Rect = el("Rect");
export const Ellipse = el("Ellipse");
export const Line = el("Line");
export const Image = el("Image");
export const Text = el("Text");
export const Transformer = el("Transformer");
export const Path = el("Path");
export const Circle = el("Circle");
export const Shape = el("Shape");
