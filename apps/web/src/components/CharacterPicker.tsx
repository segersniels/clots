import { Character, COLOR_HEX } from "@clots/character";
import { BotColor, BotShape } from "@clots/contracts";

import { Button } from "@/components/ui/button";

/** The shape grid and the color row that set the character of a bot. */
export function CharacterPicker({
  color,
  shape,
  onColorChange,
  onShapeChange,
  compact = false,
}: {
  color: BotColor;
  shape: BotShape;
  onColorChange: (color: BotColor) => void;
  onShapeChange: (shape: BotShape) => void;
  /** Sets the shapes and the colors in narrow centered blocks, for a dialog. */
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col ${compact ? "gap-6" : "gap-5"}`}>
      <div
        className={`grid grid-cols-6 justify-items-center ${compact ? "mx-auto w-full max-w-[312px] gap-y-2.5" : "gap-1"}`}
        role="radiogroup"
        aria-label="Shape"
      >
        {BotShape.literals.map((option) => (
          <Button
            key={option}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={option === shape}
            aria-label={option}
            onClick={() => onShapeChange(option)}
            className={`${compact ? "size-[38px]" : "size-12"} rounded-xl hover:bg-transparent dark:hover:bg-transparent`}
          >
            <Character
              shape={option}
              color={color}
              selected={option === shape}
              size={compact ? 38 : 36}
              className="text-foreground"
            />
          </Button>
        ))}
      </div>

      {/* The circles wrap onto centered rows, or two rows of five when compact, with room for the ring around the chosen color. */}
      <div
        className={
          compact
            ? "mx-auto grid w-[216px] grid-cols-[repeat(5,1.5rem)] justify-between gap-y-3.5"
            : "flex flex-wrap justify-center gap-x-4 gap-y-3"
        }
        role="radiogroup"
        aria-label="Color"
      >
        {BotColor.literals.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === color}
            aria-label={option}
            onClick={() => onColorChange(option)}
            className={`${compact ? "size-6" : "size-7"} rounded-full outline-[1.5px] outline-offset-[3px] transition-[outline-color,scale] duration-150 ease-out active:scale-90 motion-reduce:active:scale-100`}
            style={{
              background: COLOR_HEX[option],
              outlineStyle: "solid",
              // A soft ring marks the chosen color without competing with it.
              outlineColor:
                option === color
                  ? "color-mix(in oklab, var(--foreground) 40%, transparent)"
                  : "transparent",
            }}
          />
        ))}
      </div>
    </div>
  );
}
