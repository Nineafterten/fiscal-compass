import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { NumberField, type NumberFieldProps } from './NumberField';

type Field = Omit<NumberFieldProps, 'value' | 'onSave'>;

const dollars: Field = { prefix: '$', thousandSeparator: ',', min: 0, step: 1000 };
const year: Field = { min: 2000, max: 2100 };
const expectedReturn: Field = {
  scale: 100,
  suffix: '%',
  min: 0,
  max: 15,
  step: 0.25,
  decimalScale: 2,
};
const apr: Field = { scale: 100, suffix: '%', min: 0, max: 30, step: 0.125, decimalScale: 3 };
const confidence: Field = {
  scale: 100,
  displayDecimals: 0,
  suffix: '%',
  min: 0,
  max: 100,
  step: 5,
};

/** Renders the field the way the plan inputs do: each save is applied and re-rendered. */
function setup(initial: number, field: Field) {
  const onSave = vi.fn();
  function Editor() {
    const [value, setValue] = useState(initial);
    return (
      <NumberField
        label="Field"
        {...field}
        value={value}
        onSave={(next) => {
          onSave(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <MantineProvider>
      <Editor />
    </MantineProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Field' }) as HTMLInputElement;
  const type = (value: string) => fireEvent.change(input, { target: { value } });
  return { input, onSave, type };
}

/** The up or down chevron beside a field. */
function chevron(input: HTMLInputElement, direction: 'up' | 'down') {
  return input.parentElement!.querySelector(`[data-direction="${direction}"]`)!;
}

/** Each way to step a field, and the year it steps 2031 to. */
const steps: [string, (input: HTMLInputElement) => void, number][] = [
  ['up arrow', (input) => fireEvent.keyDown(input, { key: 'ArrowUp' }), 2032],
  ['down arrow', (input) => fireEvent.keyDown(input, { key: 'ArrowDown' }), 2030],
  ['up chevron', (input) => fireEvent.pointerDown(chevron(input, 'up')), 2032],
  ['down chevron', (input) => fireEvent.pointerDown(chevron(input, 'down')), 2030],
];

/** Renders monthly and annual views of one saved annual figure, as the income editor does. */
function setupIncome(initialAnnual: number) {
  const onSave = vi.fn();
  function Editor() {
    const [annual, setAnnual] = useState(initialAnnual);
    return (
      <>
        <NumberField
          label="Monthly"
          {...dollars}
          value={Math.round((annual / 12) * 100) / 100}
          onSave={(monthly) => {
            onSave('Monthly', monthly);
            setAnnual(monthly * 12);
          }}
        />
        <NumberField
          label="Annual"
          {...dollars}
          value={Math.round(annual)}
          onSave={(next) => {
            onSave('Annual', next);
            setAnnual(next);
          }}
        />
      </>
    );
  }
  render(
    <MantineProvider>
      <Editor />
    </MantineProvider>,
  );
  const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
  return { monthly: field('Monthly'), annual: field('Annual'), onSave };
}

describe('NumberField', () => {
  it('saves nothing for an empty field or a lone minus sign, and shows the saved value on leaving', () => {
    const { input, onSave, type } = setup(2750, dollars);
    expect(input.value).toBe('$2,750');
    type('');
    type('-');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe('$2,750');
  });

  it('zeroes a field when 0 is typed after emptying it, greying out the down chevron', () => {
    const { input, onSave, type } = setup(250, dollars);
    type('');
    type('$0');
    expect(onSave.mock.calls).toEqual([[0]]);
    expect(chevron(input, 'down')).toBeDisabled();
    fireEvent.blur(input);
    expect(input.value).toBe('$0');
  });

  it('saves the minimum when stepped down to it, greying out the down chevron', () => {
    const { input, onSave } = setup(1000, dollars);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onSave.mock.calls).toEqual([[0]]);
    expect(input.value).toBe('$0');
    expect(chevron(input, 'down')).toBeDisabled();
  });

  it('saves the maximum when it is typed, greying out the up chevron', () => {
    const { input, onSave, type } = setup(2030, year);
    type('2100');
    expect(onSave.mock.calls).toEqual([[2100]]);
    expect(chevron(input, 'up')).toBeDisabled();
  });

  it('saves the maximum when stepped up to it, greying out the up chevron', () => {
    const { input, onSave } = setup(0.95, confidence);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onSave.mock.calls).toEqual([[1]]);
    expect(input.value).toBe('100%');
    expect(chevron(input, 'up')).toBeDisabled();
  });

  it('skips a year that passes outside the limits mid-edit, keeping what was typed', () => {
    const { input, onSave, type } = setup(2030, year);
    for (const typed of ['2', '20', '203']) {
      type(typed);
      expect(input.value).toBe(typed);
    }
    expect(onSave).not.toHaveBeenCalled();
    type('2031');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenLastCalledWith(2031);
  });

  it('shows the saved year, not a clamped one, after leaving an out-of-range edit', () => {
    const { input, onSave, type } = setup(2030, year);
    type('203');
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('2030');
  });

  it('keeps the decimal point when the digit after it is deleted', () => {
    // Without it, 7.25 -> backspace twice -> 5 reads "75%", which is out of range.
    const { input, onSave, type } = setup(0.0725, expectedReturn);
    type('7.2%');
    type('7.%');
    expect(input.value).toBe('7.%');
    type('7.5%');
    expect(onSave).toHaveBeenLastCalledWith(0.075);
  });

  it('saves a percent as the fraction it stores, and shows a stored fraction as a percent', () => {
    // 0.07 × 100 is 7.000000000000001, and 0.0725 × 100 is 7.249999999999999.
    const { input, onSave, type } = setup(0.07, expectedReturn);
    expect(input.value).toBe('7%');
    type('7.25%');
    expect(onSave).toHaveBeenLastCalledWith(0.0725);
    fireEvent.blur(input);
    expect(input.value).toBe('7.25%');
  });

  it('rounds a shown percent to the places it is given', () => {
    // 0.57 × 100 is 56.99999999999999.
    expect(setup(0.57, confidence).input.value).toBe('57%');
  });

  it('groups thousands as they are typed and saves the plain number', () => {
    const { input, onSave, type } = setup(0, dollars);
    type('$125000');
    expect(input.value).toBe('$125,000');
    expect(onSave).toHaveBeenLastCalledWith(125000);
  });

  it('still steps with the arrow keys, showing whole numbers as typed ones read', () => {
    const { input, onSave } = setup(0.06875, apr);
    expect(input.value).toBe('6.875%');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onSave).toHaveBeenLastCalledWith(0.07);
    expect(input.value).toBe('7%');
  });

  it.each(steps)(
    'brings back the saved year, not the 2000 minimum, when the %s steps an emptied field, then steps from it',
    (_, step, stepped) => {
      const { input, onSave, type } = setup(2031, year);
      type('');
      step(input);
      expect(input.value).toBe('2031');
      expect(onSave).not.toHaveBeenCalled();
      step(input);
      expect(onSave.mock.calls).toEqual([[stepped]]);
    },
  );

  it('brings back a figure shown to the cent when an emptied field is stepped, saving nothing', () => {
    const { monthly, onSave } = setupIncome(90_001);
    expect(monthly.value).toBe('$7,500.08');
    fireEvent.change(monthly, { target: { value: '' } });
    fireEvent.keyDown(monthly, { key: 'ArrowUp' });
    expect(monthly.value).toBe('$7,500.08');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a value saved elsewhere while the field is not being edited, without saving it', () => {
    const { monthly, annual, onSave } = setupIncome(90_000);
    expect(monthly.value).toBe('$7,500');
    fireEvent.change(annual, { target: { value: '$96,000' } });
    expect(monthly.value).toBe('$8,000');
    fireEvent.blur(annual);
    fireEvent.change(monthly, { target: { value: '$7,000' } });
    expect(annual.value).toBe('$84,000');
    expect(onSave.mock.calls).toEqual([
      ['Annual', 96_000],
      ['Monthly', 7_000],
    ]);
  });

  it('never saves just because the field was visited', () => {
    // 35% is past the 30% limit, which Mantine would otherwise clamp to on leaving.
    const { input, onSave } = setup(0.35, apr);
    expect(input.value).toBe('35%');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('35%');
  });
});
