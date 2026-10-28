export function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasControlChars(str: string): boolean {
  return /[\x00-\x1f\x7f]/.test(str);
}
