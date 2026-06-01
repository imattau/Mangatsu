export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/_/g, '-')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}
