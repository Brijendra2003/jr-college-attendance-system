// Format validators for Maharashtra / national student identifiers (web doc §2.1, §8.3).
// SHARED. Formats marked "verify" come from secondary sources: confirm against the current
// portal before relying on them for hard validation. They are used as warnings on import.

/** General Register number: the college's own permanent number. Alphanumeric, may contain / or -. */
export const isGrNo = (v: string) => /^[A-Za-z0-9/-]{1,20}$/.test(v.trim());

/** APAAR ID (Automated Permanent Academic Account Registry): 12 digits. */
export const isApaarId = (v: string) => /^\d{12}$/.test(v.trim());

/** UDISE+ Permanent Education Number: 11 digits (verify). */
export const isPen = (v: string) => /^\d{11}$/.test(v.trim());

/** Saral student ID: long numeric ID issued by the state portal (verify exact length). */
export const isSaralId = (v: string) => /^\d{10,20}$/.test(v.trim());

/** Last four digits of Aadhaar. The full number is never stored. */
export const isAadhaarLast4 = (v: string) => /^\d{4}$/.test(v.trim());

/** HSC seat number: a letter followed by digits (verify). */
export const isHscSeatNo = (v: string) => /^[A-Za-z]\d{5,7}$/.test(v.trim());

/** Indian mobile number for contact (never used for login). */
export const isIndianMobile = (v: string) => /^(\+91[\s-]?)?[6-9]\d{9}$/.test(v.replace(/\s/g, ''));

/** Strip anything that looks like a full Aadhaar number from free text before storing it. */
export const redactAadhaar = (text: string) => text.replace(/\b\d{4}\s?\d{4}\s?(\d{4})\b/g, 'XXXX XXXX $1');
