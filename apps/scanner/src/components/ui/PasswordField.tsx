import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

/** Password input with a reveal toggle. */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { label, id, ...props },
  ref,
) {
  const [show, setShow] = useState(false);
  return (
    <div>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="relative">
        <input ref={ref} id={id} type={show ? 'text' : 'password'} className="input pr-9" {...props} />
        <button
          type="button"
          tabIndex={-1}
          disabled={props.disabled}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
});
