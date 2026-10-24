export function isUuid(value?: string | null): boolean {
  return !!value && /^[0-9a-fA-F-]{36}$/.test(value);
}
