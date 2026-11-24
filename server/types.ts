// Shared type definitions for the Budget App API.

/**
 * Loose result shape returned by service-layer functions: either an error
 * (with optional HTTP status) or a success payload with arbitrary fields.
 */
export interface ServiceResult {
  error?: string;
  status?: number;
  [key: string]: any;
}
