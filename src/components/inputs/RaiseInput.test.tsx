import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { RaiseInput } from './RaiseInput';
import type { Income } from '../../types/plan';

const salary = (growth: Partial<Income>): Income => ({
  id: 'sal',
  name: 'Salary',
  type: 'salary',
  ownerId: 'p1',
  annualGross: 100_000,
  realGrowthRate: 0,
  ...growth,
});

/** Renders the field the way the income editor does: each save is applied and re-rendered. */
function setup(initial: Income, initialCpi = 0.025) {
  const onPatch = vi.fn();
  function Editor({ cpi }: { cpi: number }) {
    const [income, setIncome] = useState(initial);
    return (
      <RaiseInput
        income={income}
        cpi={cpi}
        onPatch={(patch) => {
          onPatch(patch);
          setIncome((current) => ({ ...current, ...patch }));
        }}
      />
    );
  }
  const view = render(
    <MantineProvider>
      <Editor cpi={initialCpi} />
    </MantineProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Annual raise' }) as HTMLInputElement;
  const type = (value: string) => fireEvent.change(input, { target: { value } });
  const setCpi = (cpi: number) =>
    view.rerender(
      <MantineProvider>
        <Editor cpi={cpi} />
      </MantineProvider>,
    );
  return { input, onPatch, type, setCpi };
}

describe('RaiseInput', () => {
  it('shows the raise the engine applies, and how it is set', () => {
    expect(setup(salary({ realGrowthRate: 0.01 })).input.value).toBe('3.5%');
    expect(screen.getByText('CPI-linked, 1.0% real')).toBeInTheDocument();
  });

  it('keeps a CPI-linked raise linked when it is edited', () => {
    const { onPatch, type } = setup(salary({ realGrowthRate: 0.01 }));
    type('4%');
    expect(onPatch).toHaveBeenLastCalledWith({ realGrowthRate: expect.closeTo(1.04 / 1.025 - 1, 12) });
  });

  it('stores a fixed raise as a fixed raise', () => {
    const { input, onPatch, type } = setup(salary({ nominalGrowthRate: 0.04 }));
    expect(input.value).toBe('4%');
    expect(screen.getByText('nominal')).toBeInTheDocument();
    type('4.5%');
    expect(onPatch).toHaveBeenLastCalledWith({ nominalGrowthRate: 0.045 });
  });

  it('saves nothing for an empty field or a lone minus sign', () => {
    const { input, onPatch, type } = setup(salary({ realGrowthRate: 0.01 }));
    type('');
    type('-');
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe('3.5%');
  });

  it('skips a value that passes outside the limits mid-edit, then saves the finished one', () => {
    // Typing "2." in front of "5" goes through "25" on the way to "2.5".
    const { input, onPatch, type } = setup(salary({ nominalGrowthRate: 0.05 }));
    type('25%');
    expect(onPatch).not.toHaveBeenCalled();
    // The field must keep what was typed, or the next keystroke lands on the old text.
    expect(input.value).toBe('25%');
    type('2.5%');
    expect(onPatch).toHaveBeenLastCalledWith({ nominalGrowthRate: 0.025 });
  });

  it('keeps the decimal point when the digit after it is deleted', () => {
    // Without it, 1.5 -> backspace -> 2 reads "12%" and saves 12%.
    const { input, onPatch, type } = setup(salary({ nominalGrowthRate: 0.015 }));
    type('1.%');
    expect(input.value).toBe('1.%');
    type('1.2%');
    expect(onPatch).toHaveBeenLastCalledWith({ nominalGrowthRate: 0.012 });
  });

  it('does not trim and clamp an out-of-range number with a leading zero on leaving', () => {
    const { input, onPatch, type } = setup(salary({ nominalGrowthRate: 0.05 }));
    type('025%');
    fireEvent.blur(input);
    expect(onPatch).not.toHaveBeenCalled();
    expect(input.value).toBe('5%');
  });

  it('still steps with the arrow keys, showing whole numbers as typed ones read', () => {
    const { input, onPatch } = setup(salary({ realGrowthRate: 0.01 }));
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onPatch).toHaveBeenLastCalledWith({
      realGrowthRate: expect.closeTo(1.04 / 1.025 - 1, 12),
    });
    expect(input.value).toBe('4%');
  });

  it('follows a CPI change while the field is not being edited, without saving', () => {
    const { input, onPatch, setCpi } = setup(salary({ realGrowthRate: 0.01 }));
    setCpi(0.0275);
    expect(input.value).toBe('3.8%');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('shows what was saved after leaving a partial edit', () => {
    // "1." is a complete number, so it saves 1%.
    const { input, type } = setup(salary({ nominalGrowthRate: 0.015 }));
    type('1.%');
    fireEvent.blur(input);
    expect(input.value).toBe('1%');
  });

  it('never rewrites a raise just because the field was visited', () => {
    // A 20% premium at 6% CPI shows 27.2%, past the 20% limit.
    const { input, onPatch } = setup(salary({ realGrowthRate: 0.2 }), 0.06);
    expect(input.value).toBe('27.2%');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onPatch).not.toHaveBeenCalled();
    expect(input.value).toBe('27.2%');
  });
});
