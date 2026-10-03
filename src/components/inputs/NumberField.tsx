import { useState } from 'react';
import { NumberInput, type NumberInputProps } from '@mantine/core';

export interface NumberFieldProps
  extends Pick<
    NumberInputProps,
    | 'label'
    | 'description'
    | 'aria-label'
    | 'prefix'
    | 'suffix'
    | 'thousandSeparator'
    | 'decimalScale'
    | 'step'
    | 'size'
    | 'w'
  > {
  /** The saved value, in the units `onSave` receives. */
  value: number;
  /** Receives each complete number from `min` to `max` that is typed or stepped to. */
  onSave: (value: number) => void;
  /** The lowest number that saves, as shown. */
  min?: number;
  /** The highest number that saves, as shown. */
  max?: number;
  /** Shown units per saved unit, such as 100 for a fraction shown as a percent. */
  scale?: number;
  /** Decimal places the saved value is shown to; `decimalScale` when omitted. */
  displayDecimals?: number;
}

/**
 * A number input that saves only complete numbers within its limits.
 *
 * While the field has focus it keeps the text exactly as typed and saves each
 * complete number from `min` to `max`; "", "-" and anything out of range save
 * nothing. Leaving the field shows the saved value again, without trimming or
 * clamping what was typed. The arrow keys and chevrons step within the limits
 * and save, except on an emptied field, where they bring back the saved value
 * without saving. A new `value` shows whenever the field is not being edited,
 * and focusing and leaving the field never saves.
 */
export function NumberField({
  value,
  onSave,
  min,
  max,
  scale = 1,
  displayDecimals,
  decimalScale,
  ...presentation
}: NumberFieldProps) {
  const [draft, setDraft] = useState<number | string | null>(null);
  const decimals = displayDecimals ?? decimalScale;
  const shown = value * scale;
  const saved = decimals === undefined ? shown : Number(shown.toFixed(decimals));

  return (
    <NumberInput
      {...presentation}
      value={draft ?? saved}
      onValueChange={({ value: text }, { source }) => {
        // Mantine also reports "increment" and "decrement" here, outside the
        // declared type; only "prop" is a change the user didn't make.
        const kind = source as string;
        if (kind === 'prop') return;
        if (kind !== 'event' && draft === '') {
          // Mantine steps an empty field from 0 clamped to the limits, not from the saved value.
          setDraft(null);
          return;
        }
        const next = text.trim() === '' ? NaN : Number(text);
        // Mantine greys out a chevron at its limit only for a number, so the draft is one
        // unless that would rewrite typed text such as "7." or "05".
        setDraft(kind === 'event' && String(next) !== text ? text : next);
        if (!Number.isFinite(next)) return;
        if ((min !== undefined && next < min) || (max !== undefined && next > max)) return;
        onSave(next / scale);
      }}
      onBlur={() => setDraft(null)}
      min={min}
      max={max}
      clampBehavior="none"
      trimLeadingZeroesOnBlur={false}
      decimalScale={decimalScale}
    />
  );
}
