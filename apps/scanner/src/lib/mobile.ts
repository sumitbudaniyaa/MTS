/** Keep only digits, capped at 10 — a valid mobile number. */
export const onlyDigits10 = (v: string): string => v.replace(/\D/g, '').slice(0, 10);
