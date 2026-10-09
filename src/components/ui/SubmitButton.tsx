"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  pendingText?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
};

/** サーバーアクション実行中は無効化して「処理中」を表示する送信ボタン */
export function SubmitButton({ children, className = "btn-primary", name, value, pendingText = "処理中…", formAction }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className} disabled={pending} formAction={formAction}>
      {pending ? pendingText : children}
    </button>
  );
}
