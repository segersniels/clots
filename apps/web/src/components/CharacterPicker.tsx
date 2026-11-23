import { Character, COLOR_HEX } from "@clots/character";
import { BotColor, BotShape } from "@clots/contracts";

import { Button } from "@/components/ui/button";

/** The shape grid and the color row that set the character of a bot. */
export function CharacterPicker({
  color,
  shape,
  onColorChange,
  onShapeChange,
}: {
  color: BotColor;
  shape: BotShape;
  onColorChange: (color: BotColor) => void;
  onShapeChange: (shape: BotShape) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-6 justify-items-center gap-1" role="radiogroup" aria-label="Shape">
        {BotShape.literals.map((option) => (
          <Button
            key={option}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={option === shape}
            aria-label={option}
            onClick={() => onShapeChange(option)}
            className="size-12 rounded-xl hover:bg-transparent dark:hover:bg-transparent"
          >
            <Character shape={option} color={color} selected={option === shape} className="size-9 text-foreground" />
          </Button>
        ))}
      </div>

      <div className="flex justify-between" role="radiogroup" aria-label="Color">
        {BotColor.literals.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === color}
            aria-label={option}
            onClick={() => onColorChange(option)}
            className="size-7 rounded-full outline-2 outline-offset-2 transition-[outline-color,scale] duration-150 ease-out active:scale-90 motion-reduce:active:scale-100"
            style={{
              background: COLOR_HEX[option],
              outlineStyle: "solid",
              outlineColor: option === color ? "var(--foreground)" : "transparent",
            }}
          />
        ))}
      </div>
    </div>
  );
}
