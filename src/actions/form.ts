/** FormData から値を取り出すための小さなヘルパー */

export function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optStr(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value === "" ? null : value;
}

export function int(formData: FormData, key: string): number | null {
  const value = str(formData, key);
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function num(formData: FormData, key: string): number | null {
  const value = str(formData, key);
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function bool(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

/** カンマ・読点・改行区切りの文字列を配列にする */
export function list(formData: FormData, key: string): string[] {
  return str(formData, key)
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 同名の複数チェックボックスの値 */
export function multi(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function dateOrNull(formData: FormData, key: string): Date | null {
  const value = str(formData, key);
  if (value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function oneOf<T extends string>(formData: FormData, key: string, allowed: readonly T[]): T | null {
  const value = str(formData, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
