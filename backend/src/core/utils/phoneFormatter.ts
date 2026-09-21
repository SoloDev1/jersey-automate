/**
 * Normalizes phone numbers to a clean, standardized E.164 format.
 * Strips ALL non-digit characters to prevent injection attacks.
 * Normalizes local Nigerian numbers (080..., 090..., 070...) to international (+234...).
 */
export function formatPhoneNumber(rawPhone: string, defaultCountryCode = '234'): string {
  if (!rawPhone || typeof rawPhone !== 'string') return '';

  const trimmed = rawPhone.trim();
  const hasLeadingPlus = trimmed.startsWith('+');

  // Strip everything that is not a numeric digit
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly || digitsOnly.length < 5 || digitsOnly.length > 15) {
    return ''; // Invalid phone number length according to E.164
  }

  if (hasLeadingPlus) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith('00')) {
    return `+${digitsOnly.slice(2)}`;
  }

  // Handle local Nigerian format e.g. 08012345678 -> +2348012345678
  if (digitsOnly.startsWith('0') && digitsOnly.length === 11 && defaultCountryCode === '234') {
    return `+234${digitsOnly.slice(1)}`;
  }

  // If already starts with country code without plus e.g. 2348012345678
  if (digitsOnly.startsWith(defaultCountryCode)) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

