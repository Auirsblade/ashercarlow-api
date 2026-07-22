// apps/swdnd/src/lib/canEdit.ts
export function resolveCanEdit(opts: { admin: boolean; token: string | null | undefined }): boolean {
  return opts.admin || !!opts.token;
}
