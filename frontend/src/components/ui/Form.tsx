import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff, Search, X } from 'lucide-react';

const CONTROL = 'block rounded-lg border bg-white text-[14px] text-ink placeholder:text-ink-faint transition-colors ' +
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15 disabled:bg-canvas disabled:text-ink-muted';
const controlBorder = (invalid?: boolean) => (invalid ? 'border-danger focus:border-danger focus:ring-danger/15' : 'border-line-strong');
/** Controls fill their container unless the caller sets a width (w-56, w-full…); `w-full` would otherwise win the cascade. */
const width = (className: string) => (/(^|\s)!?w-/.test(className) ? '' : 'w-full');

interface FieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** render-prop gets the generated id and the aria-describedby value for the control */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}

export function Field({ label, hint, error, required, className = '', children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}{required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error && <p id={errId} className="mt-1 text-[12.5px] text-danger-ink">{error}</p>}
      {hint && !error && <p id={hintId} className="mt-1 text-[12.5px] text-ink-muted">{hint}</p>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { invalid?: boolean }

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className = '', ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={`${CONTROL} ${width(className)} ${controlBorder(invalid)} h-10 px-3 ${className}`} {...rest} />;
});

export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput({ invalid, className = '', ...rest }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={show ? 'text' : 'password'} aria-invalid={invalid || undefined}
        className={`${CONTROL} w-full ${controlBorder(invalid)} h-10 pl-3 pr-10 ${className}`} {...rest} />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-ink-muted hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { invalid?: boolean }

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className = '', ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={`${CONTROL} ${width(className)} ${controlBorder(invalid)} px-3 py-2 leading-relaxed ${className}`} {...rest} />;
});

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { invalid?: boolean; compact?: boolean }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, compact, className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined}
      className={`${CONTROL} ${width(className)} ${controlBorder(invalid)} ${compact ? 'h-8 pl-2.5 pr-8 text-[13px]' : 'h-10 pl-3 pr-9'} appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat ${className}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23647067' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}>
      {children}
    </select>
  );
});

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function Checkbox({ label, description, className = '', id, ...rest }: CheckboxProps) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input id={cid} type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-brand-600 accent-brand-600 focus:ring-brand-600/30"
        aria-describedby={description ? `${cid}-d` : undefined} {...rest} />
      <label htmlFor={cid} className="cursor-pointer select-none text-[13.5px] leading-5 text-ink">
        {label}
        {description && <span id={`${cid}-d`} className="block text-[12.5px] text-ink-muted">{description}</span>}
      </label>
    </div>
  );
}

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}

export function SearchInput({ value, onChange, compact, className = '', placeholder = 'Search…', ...rest }: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`${CONTROL} w-full ${controlBorder(false)} ${compact ? 'h-8 text-[13px]' : 'h-9'} pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden`} {...rest} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** A segmented control for 2–4 mutually exclusive options. */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string; size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-canvas p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md font-medium transition-colors ${size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-3 py-1 text-[13px]'} ${
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
