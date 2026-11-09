/** Codes are stable application identifiers; names follow Araria district's published block list. */
export const PANCHAYATI_RAJ_DEPARTMENT = "पंचायती राज विभाग";

export const ARARIA_BLOCKS = [
  { code: "araria", name_en: "Araria", name_hi: "अररिया" },
  { code: "bhargama", name_en: "Bhargama", name_hi: "भरगामा" },
  { code: "forbesganj", name_en: "Forbesganj", name_hi: "फारबिसगंज" },
  { code: "jokihat", name_en: "Jokihat", name_hi: "जोकीहाट" },
  { code: "kursakanta", name_en: "Kursakanta", name_hi: "कुरसाकांटा" },
  { code: "narpatganj", name_en: "Narpatganj", name_hi: "नरपतगंज" },
  { code: "palasi", name_en: "Palasi", name_hi: "पलासी" },
  { code: "raniganj", name_en: "Raniganj", name_hi: "रानीगंज" },
  { code: "sikti", name_en: "Sikti", name_hi: "सिकटी" },
] as const;

export type BlockCode = (typeof ARARIA_BLOCKS)[number]["code"];

export function blockByCode(code: string) {
  return ARARIA_BLOCKS.find((block) => block.code === code);
}
