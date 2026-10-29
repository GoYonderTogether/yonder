export const entityRef = (entity: { id: string; code?: string }) => entity.code ?? entity.id;
export const isShortCode = (ref: string) => ref.length === 6 && /^[A-Z0-9]+$/i.test(ref);
