import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Needs a server started with ICE_TRANSPORT_POLICY=relay and a TURN server
// (TURN_URLS, TURN_SECRET); CI runs the whole suite that way in a separate job.
test.skip(
  process.env.ICE_TRANSPORT_POLICY !== "relay",
  "Set ICE_TRANSPORT_POLICY=relay and a TURN server to run relay tests",
);

/** Keeps a reference to every RTCPeerConnection the page creates. */
async function trackPeerConnections(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracked: RTCPeerConnection[] = [];
    Object.assign(window, { __peerConnections: tracked });
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        tracked.push(this);
      }
    };
  });
}

/** The candidate types of the connection's selected path, e.g. ["relay", "relay"]. */
function selectedCandidateTypes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const tracked = (window as unknown as { __peerConnections: RTCPeerConnection[] })
      .__peerConnections;
    const connection = tracked.at(-1);
    if (connection === undefined) return [];
    const stats = await connection.getStats();
    let pairId: string | undefined;
    stats.forEach((report: { type: string; selectedCandidatePairId?: string }) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        pairId = report.selectedCandidatePairId;
      }
    });
    const pair = pairId === undefined ? undefined : stats.get(pairId);
    if (pair === undefined) return [];
    return [pair.localCandidateId, pair.remoteCandidateId].map(
      (id: string) => (stats.get(id) as { candidateType: string }).candidateType,
    );
  });
}

test("relay-only calls connect through the TURN server", async ({ newPerson }) => {
  const room = `relay-${Date.now()}`;
  const alice = await newPerson();
  const bob = await newPerson();
  await trackPeerConnections(alice);
  await trackPeerConnections(bob);
  await alice.goto(`/join/${room}`);
  await bob.goto(`/join/${room}`);

  for (const page of [alice, bob]) {
    await expect(page.locator(".call-status")).toHaveText("Connected", { timeout: 20_000 });
  }
  // Neither side ever used a direct path, so neither saw the other's address.
  await expect.poll(() => selectedCandidateTypes(alice)).toEqual(["relay", "relay"]);
  await expect.poll(() => selectedCandidateTypes(bob)).toEqual(["relay", "relay"]);
});
