"use client";

type Option = { value: string; label: string };

type Props = {
  name: string;
  defaultValue: string;
  options: Option[];
  className?: string;
};

/** 値を変えるとフォームを送信するセレクト */
export function AutoSubmitSelect({ name, defaultValue, options, className = "input" }: Props) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={className}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
