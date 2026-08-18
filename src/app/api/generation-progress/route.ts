import { NextResponse } from "next/server";
import { getDefaultOrganization } from "@/lib/org";
import { getGenerationState } from "@/lib/generationProgress";

// A plain Route Handler rather than a Server Action: Server Actions invoked
// from the same page are queued and dispatched one at a time by React's
// client runtime, so a poll issued this way would never actually reach the
// server while the auto-generate action is still in flight.
export async function GET() {
  const org = await getDefaultOrganization();
  return NextResponse.json(getGenerationState(org.id));
}
