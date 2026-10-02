import { Group, Slider, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export interface SliderRowProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Renders the current value — e.g. currency or percent. */
  format: (value: number) => string;
  help?: string;
  marks?: { value: number; label?: string }[];
  disabled?: boolean;
}

/**
 * A labelled slider with its live value.
 *
 * `onChange` fires continuously while dragging: the deterministic projection
 * is a few dozen iterations of arithmetic, so it re-runs per frame without a
 * debounce and the whole dashboard tracks the drag.
 */
export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  help,
  marks,
  disabled,
}: SliderRowProps) {
  return (
    <div>
      <Group justify="space-between" gap="xs" wrap="nowrap" mb={2}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm">{label}</Text>
          {help && (
            <Tooltip label={help} multiline w={280} withArrow position="top">
              <IconInfoCircle
                size={13}
                style={{ opacity: 0.45, cursor: 'help', flexShrink: 0 }}
                tabIndex={0}
                aria-label={`About ${label}`}
              />
            </Tooltip>
          )}
        </Group>
        <Text size="sm" fw={700} className="numeric">
          {format(value)}
        </Text>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        marks={marks}
        disabled={disabled}
        label={format}
        size="sm"
        mb={marks?.length ? 'lg' : 0}
        aria-label={label}
      />
    </div>
  );
}
