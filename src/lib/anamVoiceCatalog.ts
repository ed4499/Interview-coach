/**
 * Anam's stock voices, as listed in the docs' Voice Gallery (anam.ai/docs/personas/voices/gallery,
 * October 2026). The API's voice list may not include these or may not label their accents, so the
 * settings page always offers them with samples to choose by ear.
 */
import type { AnamVoice } from "./avatar";

const STOCK: [id: string, name: string, note?: string][] = [
  ["6bfbe25a-979d-40f3-a92b-5394170af54b", "Cara", "British accent (the original default)"],
  ["b7274f87-8b72-4c5b-bf52-954768b28c75", "Leo"],
  ["4bdb224b-0342-4986-9831-69a1f059103d", "Liv"],
  ["04965b9e-ff4c-4b54-a4dc-fba6e458c760", "Astrid"],
  ["c94090ba-7b30-4fe9-9a6d-e4911cef4400", "Alister"],
  ["95c6316e-85ac-41ae-a0c1-aa5bf3a91f5a", "Pablo"],
  ["c0954b69-9a2a-4fe2-8134-4e43be70f066", "William"],
  ["1c6fa8a7-9aa4-4a17-a75e-3e5eb863fccf", "Sophie"],
  ["e9104cf7-d163-4f89-b01a-311f2e8943d0", "Richard"],
  ["df2aec93-4b4e-41f2-8d02-b2d615ce184a", "Mia"],
  ["f01404e8-d9ab-4aa1-bcba-265776c9ebbc", "Layla"],
  ["13ba97ac-88e3-454f-8a49-6f9479dd4586", "Kevin"],
  ["109ecf2e-93c4-40df-9555-328c4a5f0c97", "Julia"],
  ["e4531dd3-6e63-4103-ab4a-9bd5b8c8aeed", "Hunter"],
  ["8246d9f7-827e-4a5c-8697-644ce860ca02", "Gabriel"],
  ["615ad2e8-c34a-4993-8aa3-36fd4dc3a876", "Finn"],
  ["7c917e50-c60f-47a2-85a7-78367a8ddc46", "Bella"],
  ["912ab254-9f18-4a83-bd9e-e9b1176be287", "Anne"],
];

export const STOCK_VOICES: AnamVoice[] = STOCK.map(([id, name, note]) => ({
  id,
  displayName: name,
  gender: null,
  country: id === "6bfbe25a-979d-40f3-a92b-5394170af54b" ? "GB" : null,
  description: note ?? null,
  sampleUrl: `https://lab.anam.ai/voice_samples/${name.toLowerCase()}.wav`,
  displayTags: [],
}));

/** API voices (with accent labels) plus any stock voices the API didn't return. */
export function mergeVoices(apiVoices: AnamVoice[]): AnamVoice[] {
  const byId = new Map(apiVoices.map((v) => [v.id, v]));
  for (const v of STOCK_VOICES) if (!byId.has(v.id)) byId.set(v.id, v);
  return [...byId.values()];
}
