import { getLocales } from 'expo-localization';

// Where someone is connecting from, as an ISO 3166-1 alpha-2 code ("BR").
// It is read from the phone's region setting: the country the phone is set up
// for, not a measured location.

export const REGIONS: { code: string; name: string }[] = [
  { code: 'AR', name: 'Argentina' },
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'EG', name: 'Egypt' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'AE', name: 'UAE' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
];

const NAMES = new Map(REGIONS.map((r) => [r.code, r.name]));
const UNKNOWN_FLAG = '🌍';

export function isRegionCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

/** The flag emoji for a country code: its two letters as regional-indicator symbols. */
export function flag(code: string | null | undefined): string {
  if (!isRegionCode(code)) return UNKNOWN_FLAG;
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** A name for the code; the code itself when it is a country this list does not carry. */
export function regionName(code: string | null | undefined): string {
  if (!isRegionCode(code)) return 'Somewhere';
  return NAMES.get(code) ?? code;
}

/** The phone's own region setting, if it has one. */
export function deviceRegion(): string | null {
  try {
    const code = getLocales()[0]?.regionCode?.toUpperCase();
    return isRegionCode(code) ? code : null;
  } catch {
    return null;
  }
}

// A flag for each language on offer. Languages are not countries, so this is
// a friendly picture, not a claim: the country the language is named after.
const LANGUAGE_REGION: Record<string, string> = {
  english: 'GB',
  spanish: 'ES',
  hindi: 'IN',
  french: 'FR',
  portuguese: 'PT',
  german: 'DE',
  arabic: 'SA',
  mandarin: 'CN',
  japanese: 'JP',
  korean: 'KR',
  italian: 'IT',
  turkish: 'TR',
};

export function languageFlag(language: string): string {
  return flag(LANGUAGE_REGION[language]);
}
