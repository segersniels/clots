import type { BotColor, BotShape } from "@clots/contracts";
import type { ReactNode } from "react";

export const COLOR_HEX: Record<BotColor, string> = {
  brown: "#8b6240",
  red: "#ef4444",
  orange: "#f07a2b",
  amber: "#f5a524",
  green: "#4cc96d",
  teal: "#45b8a5",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  gray: "#737373",
};

/** The outline of each shape in a 100 by 100 box. A round stroke softens the corners. */
const OUTLINE: Record<BotShape, ReactNode> = {
  circle: <circle cx="50" cy="50" r="46" />,
  oval: <ellipse cx="50" cy="52" rx="47" ry="38" />,
  square: <rect x="8" y="8" width="84" height="84" rx="24" />,
  pill: <rect x="3" y="24" width="94" height="52" rx="26" />,
  triangle: <polygon points="50,18 86,82 14,82" strokeWidth="14" strokeLinejoin="round" />,
  hexagon: <polygon points="50,12 84,31 84,69 50,88 16,69 16,31" strokeWidth="12" strokeLinejoin="round" />,
  cloud: (
    <>
      <circle cx="30" cy="58" r="24" />
      <circle cx="52" cy="42" r="26" />
      <circle cx="72" cy="58" r="22" />
      <rect x="30" y="56" width="42" height="26" />
    </>
  ),
  drop: <path d="M50 5C50 5 15 45 15 63a35 35 0 0 0 70 0C85 45 50 5 50 5Z" />,
};

/** The picture of a bot: a shape in a color, with the first letter of the name. */
export function Avatar({
  name,
  color,
  shape,
  size = 36,
  className = "",
}: {
  name: string;
  color: BotColor;
  shape: BotShape;
  size?: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <g fill={COLOR_HEX[color]} stroke={COLOR_HEX[color]} strokeWidth="0">
        {OUTLINE[shape]}
      </g>
      <text x="50" y="66" textAnchor="middle" fontSize="38" fontWeight="700" fill="white">
        {name.trim().charAt(0).toUpperCase()}
      </text>
    </svg>
  );
}
