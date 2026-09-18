export interface LanguageOption {
  code: string;
  name: string;
}

const recognitionLanguages: readonly LanguageOption[] = [
  { code: "vi", name: "Tiếng Việt" },
  { code: "en", name: "Tiếng Anh" },
  { code: "zh", name: "Tiếng Trung" },
  { code: "ja", name: "Tiếng Nhật" },
  { code: "ko", name: "Tiếng Hàn" },
  { code: "fr", name: "Tiếng Pháp" },
  { code: "de", name: "Tiếng Đức" },
  { code: "es", name: "Tiếng Tây Ban Nha" },
  { code: "pt", name: "Tiếng Bồ Đào Nha" },
  { code: "it", name: "Tiếng Ý" },
  { code: "ru", name: "Tiếng Nga" },
  { code: "th", name: "Tiếng Thái" },
  { code: "ar", name: "Tiếng Ả Rập" },
];

export function buildLanguageOptions(codes: string[]): LanguageOption[] {
  const availableCodes = new Set(codes);
  return recognitionLanguages.filter(({ code }) => availableCodes.has(code));
}
