import { pointer, prefersReducedMotion, type Animated } from "./frameLoop.ts";
import { MAX_LOBES, NO_FIT, SHAPE_GEOMETRY, shapeFit, type CharacterShape, type Lobe, type ShapeFit } from "./traits.ts";

/** States what the character does now. The motion shows it, so a list needs no spinner. */
export type CharacterMood = "idle" | "working" | "waiting";

/** A point that the eyes look at, from -1 to 1 on each axis, relative to the center of the character. */
export interface Gaze {
  x: number;
  y: number;
}

/** The props that change the motion between two React renders. */
export interface MotionProps {
  shape: CharacterShape;
  mood: CharacterMood;
  gaze: Gaze | undefined;
  /** Scales the art to fill its box. A character that can be selected keeps room for its ring instead. */
  fitted: boolean;
  /** Counts the hops that the character was asked for. Each new count makes it hop once. */
  hops: number;
}

const MORPH_MS = 720;
const HOP_MS = 700;
const BLINK_MS = 160;

/** How far the pupils move from the center of the eye position, in box units. */
const EYE_REACH = { x: 3.4, y: 3 };

/** Pads a shape to the same lobe count as the others. The extra lobes hide inside the body. */
export function paddedLobes(shape: CharacterShape): Lobe[] {
  const lobes = [...SHAPE_GEOMETRY[shape].lobes];
  const [cx, cy] = lobes[0]!;

  while (lobes.length < MAX_LOBES) lobes.push([cx, cy, 0]);

  return lobes;
}

/** Finds the lobe that carries the sheen, so the sheen never sits between the eyes. */
function sheenLobeOf(shape: CharacterShape): Lobe {
  const { lobes, sheenLobe = 0 } = SHAPE_GEOMETRY[shape];

  return lobes[sheenLobe]!;
}

/** The blur alpha at which the goo filter cuts off the edge of the body. */
const GOO_CUTOFF = 0.42;

/** Builds the goo filter matrix. A higher sharpness gives a harder edge. */
export function gooMatrix(sharpness: number) {
  return `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${sharpness} ${-sharpness * GOO_CUTOFF}`;
}

/** Eases toward 1 with a small overshoot, so lobes wobble like liquid when they settle. */
const springEase = (t: number) => 1 - Math.exp(-6.5 * t) * Math.cos(10.5 * t);

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * Moves the parts of one rendered character every frame. It writes SVG attributes directly, so
 * React renders the character only when its props change.
 */
export class CharacterMotion implements Animated {
  private readonly layers: Array<{ grow: number; circles: SVGCircleElement[] }>;
  private readonly root: SVGGElement;
  private readonly sheen: SVGEllipseElement;
  private readonly eyes: SVGEllipseElement[];
  private readonly phase = Math.random() * 10;

  private shape: CharacterShape;
  private fromLobes: Lobe[];
  private toLobes: Lobe[];
  private fromEyes: readonly number[];
  private toEyes: readonly number[];
  private fromSheenLobe: Lobe;
  private toSheenLobe: Lobe;
  private fromFit: ShapeFit;
  private toFit: ShapeFit;
  private morphStart = -Infinity;
  private hopStart = -Infinity;
  private hops: number;
  private blinkStart = -Infinity;
  private nextBlink = performance.now() + 1200 + Math.random() * 3000;
  private gaze = { x: 0, y: 0 };
  private center: { x: number; y: number } | undefined;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly props: () => MotionProps,
  ) {
    this.layers = [...svg.querySelectorAll<SVGGElement>("g[data-grow]")].map((group) => ({
      grow: Number(group.dataset.grow),
      circles: [...group.querySelectorAll("circle")],
    }));
    this.root = svg.querySelector("g[data-root]")!;
    this.sheen = svg.querySelector("ellipse[data-sheen]")!;
    this.eyes = [...svg.querySelectorAll<SVGEllipseElement>("ellipse[data-eye]")];

    // The edge ramp spans about one device pixel. A fixed sharpness looks jagged at sidebar sizes.
    const pixels = svg.getBoundingClientRect().width * devicePixelRatio;
    const sharpness = pixels > 0 ? Math.min(24, Math.max(3, pixels / 8)) : 24;
    svg.querySelector("feColorMatrix[data-goo]")!.setAttribute("values", gooMatrix(sharpness));

    this.shape = props().shape;
    this.hops = props().hops;
    this.fromLobes = this.toLobes = paddedLobes(this.shape);
    this.fromEyes = this.toEyes = SHAPE_GEOMETRY[this.shape].eyes;
    this.fromSheenLobe = this.toSheenLobe = sheenLobeOf(this.shape);
    this.fromFit = this.toFit = this.fitOf(this.shape);
  }

  measure() {
    const { mood, gaze } = this.props();

    // Only an idle character without a set gaze follows the pointer, so only it needs its position.
    if (mood !== "idle" || gaze !== undefined || !pointer.seen) return;

    const box = this.svg.getBoundingClientRect();
    this.center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  draw(now: number) {
    const { shape, mood, gaze, hops } = this.props();
    const reduced = prefersReducedMotion();
    const t = now / 1000 + this.phase;

    if (shape !== this.shape) this.startMorph(shape, now, reduced);

    if (hops !== this.hops) {
      this.hops = hops;
      if (!reduced) this.hopStart = now;
    }

    const lobes = this.lobesAt(now);
    const [eyeX, eyeY, eyeGap] = this.eyesAt(now);
    const [bodyX, bodyY, bodyR] = lobes[0]!;

    // A working character has a droplet that rolls around the edge of its body.
    const dropletAngle = reduced ? -0.8 : t * 2.4;
    const droplet: Lobe =
      mood === "working"
        ? [bodyX + Math.cos(dropletAngle) * bodyR * 0.98, bodyY + Math.sin(dropletAngle) * bodyR * 0.98, Math.max(5.5, bodyR * 0.22)]
        : [bodyX, bodyY, 0];

    for (const { grow, circles } of this.layers) {
      [...lobes, droplet].forEach(([cx, cy, r], index) => {
        const isSideLobe = index > 0 && index < MAX_LOBES && r > 0;
        const wobble = !reduced && mood === "working" && isSideLobe ? Math.sin(t * 3 + index * 1.9) * 1.6 : 0;
        const circle = circles[index]!;

        circle.setAttribute("cx", String(cx + wobble));
        circle.setAttribute("cy", String(cy - wobble * 0.7));
        circle.setAttribute("r", String(r > 0 ? r + grow : 0));
      });
    }

    // The squash and the hop pivot on the bottom of the art, so the character stands on the ground.
    const fit = this.fitAt(now);
    const { scaleX, scaleY, lift } = reduced ? { scaleX: 1, scaleY: 1, lift: 0 } : this.bounce(now, mood);
    this.root.setAttribute(
      "transform",
      `translate(50 ${fit.bottom - lift}) scale(${scaleX} ${scaleY}) translate(-50 -${fit.bottom}) ` +
        `translate(50 50) scale(${fit.scale}) translate(${-fit.x} ${-fit.y})`,
    );

    const [lightX, lightY, lightR] = this.sheenLobeAt(now);
    const sheenX = lightX - lightR * 0.42;
    const sheenY = lightY - lightR * 0.48;
    this.sheen.setAttribute("cx", String(sheenX));
    this.sheen.setAttribute("cy", String(sheenY));
    this.sheen.setAttribute("rx", String(lightR * 0.2));
    this.sheen.setAttribute("ry", String(lightR * 0.11));
    this.sheen.setAttribute("transform", `rotate(-35 ${sheenX} ${sheenY})`);

    this.drawEyes(now, eyeX, eyeY, eyeGap, this.aim(t, mood, gaze), reduced, mood);
  }

  private startMorph(shape: CharacterShape, now: number, reduced: boolean) {
    this.fromLobes = this.lobesAt(now);
    this.fromEyes = this.eyesAt(now);
    this.toLobes = paddedLobes(shape);
    this.toEyes = SHAPE_GEOMETRY[shape].eyes;
    this.fromSheenLobe = this.sheenLobeAt(now);
    this.toSheenLobe = sheenLobeOf(shape);
    this.fromFit = this.fitAt(now);
    this.toFit = this.fitOf(shape);
    this.shape = shape;

    if (reduced) return;

    this.morphStart = now;
    this.hopStart = now;
  }

  private morphProgress(now: number) {
    const t = (now - this.morphStart) / MORPH_MS;

    return t >= 1 ? 1 : springEase(t);
  }

  private lobesAt(now: number): Lobe[] {
    const progress = this.morphProgress(now);

    return this.toLobes.map(([cx, cy, r], index) => {
      const [fromX, fromY, fromR] = this.fromLobes[index]!;

      return [lerp(fromX, cx, progress), lerp(fromY, cy, progress), Math.max(0, lerp(fromR, r, progress))];
    });
  }

  private fitOf(shape: CharacterShape) {
    return this.props().fitted ? shapeFit(shape) : NO_FIT;
  }

  private fitAt(now: number): ShapeFit {
    const progress = this.morphProgress(now);

    return {
      x: lerp(this.fromFit.x, this.toFit.x, progress),
      y: lerp(this.fromFit.y, this.toFit.y, progress),
      scale: lerp(this.fromFit.scale, this.toFit.scale, progress),
      bottom: lerp(this.fromFit.bottom, this.toFit.bottom, progress),
    };
  }

  private eyesAt(now: number) {
    const progress = this.morphProgress(now);

    return this.toEyes.map((value, index) => lerp(this.fromEyes[index]!, value, progress)) as [number, number, number];
  }

  /** Moves the sheen from the lobe of the old shape to the lobe of the new one, so it never jumps. */
  private sheenLobeAt(now: number): Lobe {
    const progress = this.morphProgress(now);
    const [fromX, fromY, fromR] = this.fromSheenLobe;
    const [toX, toY, toR] = this.toSheenLobe;

    return [lerp(fromX, toX, progress), lerp(fromY, toY, progress), lerp(fromR, toR, progress)];
  }

  /** Breathes all the time, and hops after a shape change or on a loop while the character waits. */
  private bounce(now: number, mood: CharacterMood) {
    const t = now / 1000 + this.phase;
    const breath = Math.sin(t * 1.85);
    let scaleX = 1 - breath * 0.012;
    let scaleY = 1 + breath * 0.022;
    let lift = 0;

    const hopT = (now - this.hopStart) / HOP_MS;
    const waitingCycle = mood === "waiting" ? (t % 2.6) / 2.6 : -1;
    const p = hopT >= 0 && hopT < 1 ? hopT * 0.42 : waitingCycle;

    // A hop is a squash, a jump and a squash on landing.
    if (p >= 0 && p < 0.06) {
      const k = Math.sin((p / 0.06) * Math.PI);
      scaleY -= k * 0.08;
      scaleX += k * 0.06;
    } else if (p >= 0.06 && p < 0.3) {
      const k = Math.sin(((p - 0.06) / 0.24) * Math.PI);
      lift = k * 11;
      scaleY += k * 0.06;
      scaleX -= k * 0.04;
    } else if (p >= 0.3 && p < 0.38) {
      const k = Math.sin(((p - 0.3) / 0.08) * Math.PI);
      scaleY -= k * 0.09;
      scaleX += k * 0.07;
    }

    return { scaleX, scaleY, lift };
  }

  /** Works out where the eyes look, in box units from their resting place. */
  private aim(t: number, mood: CharacterMood, gaze: Gaze | undefined): Gaze {
    if (gaze !== undefined) return { x: gaze.x * EYE_REACH.x, y: gaze.y * EYE_REACH.y };

    // A waiting character looks right at the operator.
    if (mood === "waiting") return { x: 0, y: 0.6 };

    // A working character watches its droplet.
    if (mood === "working") return { x: Math.cos(t * 2.4) * 2.6, y: Math.sin(t * 2.4) * 2.2 };

    if (this.center === undefined) return { x: 0, y: 0 };

    const dx = pointer.x - this.center.x;
    const dy = pointer.y - this.center.y;
    const distance = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, distance / 220);

    return { x: (dx / distance) * EYE_REACH.x * reach, y: (dy / distance) * EYE_REACH.y * reach };
  }

  private drawEyes(now: number, x: number, y: number, gap: number, target: Gaze, reduced: boolean, mood: CharacterMood) {
    const ease = reduced ? 1 : 0.14;
    this.gaze.x += (target.x - this.gaze.x) * ease;
    this.gaze.y += (target.y - this.gaze.y) * ease;

    if (!reduced && now > this.nextBlink) {
      this.blinkStart = now;
      this.nextBlink = now + 2400 + Math.random() * 4200;
    }

    const blinkT = (now - this.blinkStart) / BLINK_MS;
    const blink = blinkT >= 0 && blinkT < 1 ? Math.sin(blinkT * Math.PI) : 0;
    const radius = (gap / 12) * 4.3 * (mood === "waiting" ? 1.12 : 1);

    this.eyes.forEach((eye, index) => {
      const side = index === 0 ? -1 : 1;

      eye.setAttribute("cx", String(x + this.gaze.x + side * gap * 0.5));
      eye.setAttribute("cy", String(y + this.gaze.y));
      eye.setAttribute("rx", String(radius));
      eye.setAttribute("ry", String(radius * 1.25 * (1 - blink * 0.88)));
    });
  }
}
