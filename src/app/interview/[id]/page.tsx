import { notFound, redirect } from "next/navigation";
import { getCandidateId } from "@/lib/candidate";
import { CATEGORY_LABELS, LEVEL_LABELS } from "@/lib/config";
import { getInterviewState, getSession } from "@/lib/interview";
import { avatarClientConfig } from "@/lib/avatar";
import InterviewRunner from "@/components/InterviewRunner";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await getCandidateId();
  const s = candidate ? getSession(id, candidate) : null;
  if (!s) notFound();
  if (s.status !== "in_progress") redirect(`/interview/${id}/results`);
  return (
    <InterviewRunner
      initial={getInterviewState(s)}
      levelLabel={LEVEL_LABELS[s.experience_level]}
      categoryLabels={CATEGORY_LABELS}
      avatar={avatarClientConfig()}
    />
  );
}
