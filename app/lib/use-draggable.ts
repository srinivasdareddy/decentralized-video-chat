import { useEffect, useRef, useState, type PointerEvent } from "react";

interface Offset {
  x: number;
  y: number;
}

interface Drag {
  pointerId: number;
  start: Offset;
  origin: Offset;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Lets an element be dragged anywhere inside the viewport with a mouse,
 * pen, or finger. The element keeps its CSS position; dragging adds a
 * translate offset.
 */
export function useDraggable<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const drag = useRef<Drag | null>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Keep the element on screen when the window shrinks.
  useEffect(() => {
    const keepInView = () => {
      const element = ref.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      const dx = rect.left < 0 ? -rect.left : Math.min(0, window.innerWidth - rect.right);
      const dy = rect.top < 0 ? -rect.top : Math.min(0, window.innerHeight - rect.bottom);
      if (dx !== 0 || dy !== 0) setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
    };
    window.addEventListener("resize", keepInView);
    return () => window.removeEventListener("resize", keepInView);
  }, []);

  const onPointerDown = (event: PointerEvent<T>) => {
    const element = ref.current;
    if (element === null || event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
      bounds: {
        minX: offset.x - rect.left,
        maxX: offset.x + window.innerWidth - rect.right,
        minY: offset.y - rect.top,
        maxY: offset.y + window.innerHeight - rect.bottom,
      },
    };
    element.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<T>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const { start, origin, bounds } = current;
    setOffset({
      x: clamp(origin.x + event.clientX - start.x, bounds.minX, bounds.maxX),
      y: clamp(origin.y + event.clientY - start.y, bounds.minY, bounds.maxY),
    });
  };

  const onPointerEnd = (event: PointerEvent<T>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return {
    ref,
    dragging,
    style: { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` },
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
