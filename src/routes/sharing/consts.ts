/** Most descriptor documents a computer holds at the same time. */
export const DESCRIPTOR_MAX_DOCUMENTS = 4

/** Most bytes the descriptor documents of a computer may hold in total (also the limit of one descriptor). */
export const DESCRIPTOR_MAX_TOTAL_BYTES = 16 * 1024 * 1024

/** A descriptor document is dropped this long after its reply. */
export const DESCRIPTOR_TTL_MS = 120_000

/** Name prefix of descriptor documents; the rest is 16 hex characters. */
export const DESCRIPTOR_DOCUMENT_PREFIX = 'rd-'
