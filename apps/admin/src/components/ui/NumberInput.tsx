import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  label?: string;
  error?: string;
  value: number;
  onChange: (n: number) => void;
}

/**
 * Numeric input that:
 *  - shows NO spinner arrows (text field with numeric keypad), and
 *  - can be fully cleared while typing (the field is allowed to be empty; an empty value
 *    reports 0 but the box stays blank until blur, so you can delete all digits and retype).
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { label, error, value, onChange, className, id, ...rest },
  ref,
) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Sync from the parent only when not actively editing, so clearing the field sticks.
  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? String(value) : '');
  }, [value, focused]);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        inputMode="numeric"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(String(value));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d]/g, '');
          setText(t);
          onChange(t === '' ? 0 : Number(t));
        }}
        className={cn('input', error && 'border-danger', className)}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
});
