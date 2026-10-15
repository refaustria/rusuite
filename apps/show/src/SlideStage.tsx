import { useEffect, useRef, useState } from "react";
import { Ellipse, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";

/** Logical slide size (16:9); the stage scales this to the available space. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** Largest 16:9 box that fits in `w` x `h`, as a scale factor of the logical slide. */
export function fitScale(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  return Math.min(w / SLIDE_W, h / SLIDE_H);
}

interface Props {
  title: string;
  /** Available space in CSS pixels; the slide is scaled to fit. */
  width: number;
  height: number;
  /** Editing mode: shapes are draggable and resizable. Off while presenting. */
  editable?: boolean;
}

export function SlideStage({ title, width, height, editable = true }: Props) {
  const scale = fitScale(width, height);
  const [selected, setSelected] = useState<string | null>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const nodes = useRef<Record<string, Konva.Node | null>>({});

  useEffect(() => {
    const node = editable && selected ? nodes.current[selected] : null;
    transformer.current?.nodes(node ? [node] : []);
    transformer.current?.getLayer()?.batchDraw();
  }, [selected, editable]);

  const pick = (id: string) => ({
    ref: (n: Konva.Node | null) => {
      nodes.current[id] = n;
    },
    draggable: editable,
    onMouseDown: () => setSelected(id),
    onTap: () => setSelected(id),
  });

  if (scale === 0) return null;
  return (
    <Stage
      width={SLIDE_W * scale}
      height={SLIDE_H * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) setSelected(null);
      }}
    >
      <Layer>
        <Rect name="slide-background" x={0} y={0} width={SLIDE_W} height={SLIDE_H} fill="#ffffff" listening={false} />
        <Text
          {...pick("title")}
          text={title}
          x={80}
          y={60}
          width={SLIDE_W - 160}
          fontSize={64}
          fontStyle="bold"
          fill="#1f2328"
        />
        <Rect {...pick("rect")} x={120} y={280} width={420} height={260} fill="#c2410c" cornerRadius={12} />
        <Ellipse {...pick("ellipse")} x={860} y={410} radiusX={190} radiusY={130} fill="#2b579a" />
        <Transformer ref={transformer} rotateEnabled={false} keepRatio={false} />
      </Layer>
    </Stage>
  );
}
