import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "./Icon";

interface FieldWrapProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

function FieldWrap({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: FieldWrapProps) {
  return (
    <div className={`gg-field ${error ? "gg-field--error" : ""}`}>
      <label className="gg-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="gg-field__req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="gg-field__hint">{hint}</p>}
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, id, required, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrap
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <input
        id={fieldId}
        className="gg-input"
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
    </FieldWrap>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextArea({ label, error, hint, id, required, ...rest }: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrap
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <textarea
        id={fieldId}
        className="gg-input gg-textarea"
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
    </FieldWrap>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  hint,
  id,
  required,
  children,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrap
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="gg-select-wrap">
        <select id={fieldId} className="gg-input gg-select" required={required} {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" size={16} className="gg-select-caret" />
      </div>
    </FieldWrap>
  );
}

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

/** Compact search box with a leading icon; label is visually hidden. */
export function SearchInput({ label, id, ...rest }: SearchInputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="gg-search">
      <label htmlFor={fieldId} className="gg-visually-hidden">
        {label}
      </label>
      <Icon name="search" size={16} className="gg-search__icon" />
      <input id={fieldId} type="search" className="gg-input gg-search__input" {...rest} />
    </div>
  );
}
