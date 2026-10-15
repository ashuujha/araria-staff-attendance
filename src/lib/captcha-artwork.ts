// Embedded vector strokes: no server fonts, fontconfig or SVG <text> required.
// Coordinates use a 20 × 28 grid, scaled when drawing the image.
export const captchaGlyphs: Record<string, string> = {
  A: "M1 28 10 1 19 28 M5 18H15",
  B: "M1 1V27H11Q19 27 19 20Q19 14 11 14H1 M1 1H10Q18 1 18 7Q18 14 10 14",
  C: "M19 4Q15 1 10 1Q1 1 1 14Q1 27 10 27Q16 27 19 24",
  D: "M1 1V27H8Q19 27 19 14Q19 1 8 1Z",
  E: "M19 1H1V27H19 M1 14H16",
  F: "M19 1H1V28 M1 14H16",
  G: "M19 4Q15 1 10 1Q1 1 1 14Q1 27 10 27Q16 27 19 24V15H11",
  H: "M1 1V27 M19 1V27 M1 14H19",
  J: "M6 1H19 M15 1V21Q15 27 8 27Q1 27 1 21",
  K: "M1 1V27 M19 1 1 17 M7 11 19 27",
  L: "M1 1V27H19",
  M: "M1 27V1L10 16 19 1V27",
  N: "M1 27V1L19 27V1",
  P: "M1 28V1H11Q19 1 19 8Q19 15 11 15H1",
  Q: "M10 1Q1 1 1 14Q1 27 10 27Q19 27 19 14Q19 1 10 1Z M12 21 21 30",
  R: "M1 28V1H11Q19 1 19 8Q19 15 11 15H1 M10 15 20 28",
  S: "M19 4Q15 1 10 1Q1 1 1 8Q1 13 10 14Q19 15 19 21Q19 27 10 27Q4 27 1 24",
  T: "M0 1H20 M10 1V28",
  U: "M1 1V19Q1 27 10 27Q19 27 19 19V1",
  V: "M1 1 10 28 19 1",
  W: "M0 1 4 27 10 13 16 27 20 1",
  X: "M1 1 19 27 M19 1 1 27",
  Y: "M1 1 10 14 19 1 M10 14V28",
  Z: "M1 1H19L1 27H19",
  2: "M1 6Q3 1 10 1Q19 1 19 8Q19 12 13 17L1 27H19",
  3: "M1 3Q5 1 10 1Q19 1 19 7Q19 14 10 14 M9 14Q19 14 19 21Q19 27 10 27Q4 27 1 24",
  4: "M15 28V1L1 20H20",
  5: "M19 1H2L1 13Q6 11 11 11Q19 11 19 19Q19 27 10 27Q4 27 1 24",
  6: "M18 3Q14 1 10 1Q1 1 1 15V19Q1 27 10 27Q19 27 19 19Q19 12 10 12Q4 12 1 17",
  7: "M1 1H19L7 28",
  8: "M10 1Q1 1 1 7Q1 14 10 14Q19 14 19 7Q19 1 10 1Z M10 14Q1 14 1 21Q1 27 10 27Q19 27 19 21Q19 14 10 14Z",
  9: "M19 12Q16 16 10 16Q1 16 1 8Q1 1 10 1Q19 1 19 9V14Q19 27 10 27Q5 27 2 25",
};

export function captchaLetter(letter: string, index: number, rotation: number) {
  const path = captchaGlyphs[letter];
  if (!path) throw Error("Unsupported CAPTCHA character");
  return `<g transform="translate(${24 + index * 44} 22) rotate(${rotation} 14 20)"><path d="${path}" transform="scale(1.35)" fill="none" stroke="#1b3048" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
