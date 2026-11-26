import { useEffect, useId, useRef, useState } from "react";

import {
  CharacterMotion,
  gooMatrix,
  paddedLobes,
  type CharacterMood,
  type Gaze,
  type MotionProps,
} from "./CharacterMotion.ts";
import { animate, wake } from "./frameLoop.ts";
import {
  COLOR_HEX,
  MAX_LOBES,
  NO_FIT,
  SHAPE_GEOMETRY,
  shapeFit,
  type CharacterColor,
  type CharacterShape,
} from "./traits.ts";

/** The lobes plus one slot for the droplet of a working character. */
const CIRCLES = MAX_LOBES + 1;

/** How much the selection ring and the gap inside it grow past the body, in box units. */
const RING = { outer: 7, inner: 3.5 };

const EYE_COLOR = "#141416";

/**
 * Draws a clot: round lobes that melt together, with a face. It breathes and blinks, morphs when
 * its shape changes and shows its mood with motion.
 */
export function Character({
  shape,
  color,
  mood = "idle",
  size = 36,
  selected,
  gaze,
  hops = 0,
  className,
}: {
  shape: CharacterShape;
  color: CharacterColor;
  mood?: CharacterMood;
  size?: number;
  /** Draws a ring in the current text color that follows the outline. Leave it out where nothing selects. */
  selected?: boolean;
  /** Makes the eyes look at a point. Without it, an idle character looks straight ahead. */
  gaze?: Gaze | undefined;
  /** Counts the hops that the character was asked for, such as one for each save. Each new count makes it hop once. */
  hops?: number;
  className?: string;
}) {
  const id = useId().replace(/[^\w-]/g, "");
  const box = useRef<HTMLSpanElement>(null);
  // Without a selection ring, the art can fill its box.
  const fitted = selected === undefined;
  const props = useRef<MotionProps>({ shape, mood, gaze, fitted, hops });

  // React draws the first shape only. After that, the motion owns the geometry, so a new shape can morph.
  const [firstShape] = useState(shape);
  const lobes = paddedLobes(firstShape);
  const [eyeX, eyeY, eyeGap] = SHAPE_GEOMETRY[firstShape].eyes;
  const fit = fitted ? shapeFit(firstShape) : NO_FIT;

  useEffect(() => {
    props.current = { shape, mood, gaze, fitted, hops };
  });

  // The loop stops while no character moves, so a change that the motion has to show starts it.
  useEffect(() => {
    wake();
  }, [mood, shape, hops, gaze?.x, gaze?.y]);

  useEffect(() => {
    const motion = new CharacterMotion(box.current!, () => props.current);
    const stop = animate(motion);

    return () => {
      stop();
      motion.dispose();
    };
  }, []);

  const circles = (grow: number) =>
    Array.from({ length: CIRCLES }, (_, index) => {
      const [cx, cy, r] = lobes[index] ?? lobes[0]!;

      return <circle key={index} cx={cx} cy={cy} r={index < MAX_LOBES && r > 0 ? r + grow : 0} />;
    });

  return (
    // The browser moves an HTML box without drawing it again. It cannot do that for an SVG element on a high-density screen, so the breath moves this box.
    <span
      ref={box}
      aria-hidden
      className={className}
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} overflow="visible">
        <defs>
          {/* Blurs the lobes together and cuts the blur off sharp, so they melt like liquid. */}
          <filter
            id={`${id}-goo`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              data-goo=""
              in="blur"
              mode="matrix"
              values={gooMatrix(24)}
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>

          {selected !== undefined && (
            <mask
              id={`${id}-ring`}
              maskUnits="userSpaceOnUse"
              x="-20"
              y="-20"
              width="140"
              height="140"
            >
              <g data-grow={RING.outer} filter={`url(#${id}-goo)`} fill="white">
                {circles(RING.outer)}
              </g>
              <g data-grow={RING.inner} filter={`url(#${id}-goo)`} fill="black">
                {circles(RING.inner)}
              </g>
            </mask>
          )}
        </defs>

        <g
          data-root=""
          transform={`translate(50 50) scale(${fit.scale}) translate(${-fit.x} ${-fit.y})`}
        >
          {selected !== undefined && (
            <rect
              x="-20"
              y="-20"
              width="140"
              height="140"
              fill="currentColor"
              mask={`url(#${id}-ring)`}
              style={{ opacity: selected ? 1 : 0, transition: "opacity 200ms ease-out" }}
            />
          )}

          <g
            data-grow="0"
            filter={`url(#${id}-goo)`}
            style={{ fill: COLOR_HEX[color], transition: "fill 350ms ease-out" }}
          >
            {circles(0)}
          </g>

          <ellipse data-sheen="" fill="white" opacity="0.2" />

          <g fill={EYE_COLOR}>
            <ellipse
              data-eye=""
              cx={eyeX - eyeGap / 2}
              cy={eyeY}
              rx={(eyeGap / 12) * 4.3}
              ry={(eyeGap / 12) * 5.4}
            />
            <ellipse
              data-eye=""
              cx={eyeX + eyeGap / 2}
              cy={eyeY}
              rx={(eyeGap / 12) * 4.3}
              ry={(eyeGap / 12) * 5.4}
            />
          </g>
        </g>
      </svg>
    </span>
  );
}
