import type { ChangeEvent } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

/** Keep only digits, capped at 10 — a valid mobile number. */
export const onlyDigits10 = (v: string): string => v.replace(/\D/g, '').slice(0, 10);

/**
 * Spread onto a react-hook-form-registered mobile input to strictly enforce digits-only,
 * max 10 characters, while keeping RHF tracking intact.
 */
export function mobileField(reg: UseFormRegisterReturn) {
  return {
    ...reg,
    inputMode: 'numeric' as const,
    maxLength: 10,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      e.target.value = onlyDigits10(e.target.value);
      return reg.onChange(e);
    },
  };
}
