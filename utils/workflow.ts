export const normalizeWorkflow = (w?: string | null) =>
  w === 'delivery' ? 'store_delivery' : w ?? null;

export const isStoreWorkflow = (w?: string | null) =>
  w === 'store_delivery' || w === 'delivery';
