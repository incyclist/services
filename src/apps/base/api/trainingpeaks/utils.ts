/** @returns true if the string is base64 encoded (without line breaks) */
export const isBase64 = (value: string): boolean => /^[A-Za-z0-9+/]+={0,2}$/.test(value)
