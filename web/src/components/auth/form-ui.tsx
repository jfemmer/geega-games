'use client';

/**
 * form-ui.tsx — Small shared building blocks for the auth forms: a text field
 * with inline error, a submit button that shows a pending spinner (via
 * useFormStatus), and alert banners. Keeps the pages clean and consistent.
 */
import { useFormStatus } from 'react-dom';

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required,
  error,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  error?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
            : 'border-neutral-300 focus:border-brand focus:ring-brand-200'
        }`}
      />
      {error && (
        <p id={`${name}-error`} className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {children}
    </button>
  );
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
    >
      {message}
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-brand">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-neutral-600">{footer}</div>}
    </main>
  );
}
