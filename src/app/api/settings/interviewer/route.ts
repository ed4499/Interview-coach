import { NextResponse } from "next/server";
import { handler, readJson } from "@/lib/api";
import { AvatarUnavailableError, VOICE_SETTING, getAnamVoice } from "@/lib/avatar";
import { ServiceError } from "@/lib/interview";
import { setSetting } from "@/lib/settings";
import { STOCK_VOICES } from "@/lib/anamVoiceCatalog";

/** Saves the interviewer voice (an Anam voice id), or resets it with { voiceId: null }. */
export const POST = handler(async (req: Request) => {
  const { voiceId } = await readJson(req);
  if (voiceId === null) {
    setSetting(VOICE_SETTING, null);
    return NextResponse.json({ ok: true, saved: true });
  }
  if (typeof voiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(voiceId)) throw new ServiceError("Invalid voice id.");
  // Accept Anam's standard voices directly; anything else must exist in this Anam account.
  if (!STOCK_VOICES.some((v) => v.id === voiceId)) {
    try {
      await getAnamVoice(voiceId);
    } catch (err) {
      if (err instanceof AvatarUnavailableError) throw new ServiceError("That voice could not be verified with Anam.", 400);
      throw err;
    }
  }
  setSetting(VOICE_SETTING, voiceId);
  return NextResponse.json({ ok: true, saved: true });
});
