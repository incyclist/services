/**
 * Removes the line breaks and the padding around the text of XML elements, e.g. `<Id>\n      value\n    </Id>` becomes `<Id>value</Id>`.
 *
 * The TCX files written by the activity exporter contain such padding in every element. Other apps accept it,
 * but TrainingPeaks does not understand these files (the upload is accepted and the processing then fails with `FileNotUnderstood`).
 * Whitespace between elements is removed as well, the content of the file is not changed otherwise.
 */
export const trimXmlTextNodes = (xml: string): string => xml.replaceAll(/>([^<]+)</g, (_match, text: string) => `>${text.trim()}<`)

/** @returns true if the string is base64 encoded (without line breaks) */
export const isBase64 = (value: string): boolean => /^[A-Za-z0-9+/]+={0,2}$/.test(value)
