import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  TestServer,
  expectConnected,
  peerConnectionCount,
  trackPeerConnections,
  uniqueRoom,
} from "./helpers.ts";

// These tests stop and restart a server of their own, so they need to start
// one locally.
test.skip(Boolean(process.env.E2E_BASE_URL), "Needs to run its own server");

let server: TestServer;
test.beforeEach(async () => {
  server = await TestServer.start();
});
test.afterEach(async () => {
  await server.stop();
});

async function joinOwnServer(newPerson: () => Promise<Page>, room: string): Promise<Page> {
  const page = await newPerson();
  await trackPeerConnections(page);
  await page.goto(`${server.url}/join/${room}`);
  return page;
}

test("a call carries on while the server restarts", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await joinOwnServer(newPerson, room);
  const bob = await joinOwnServer(newPerson, room);
  await expectConnected(alice);
  await expectConnected(bob);

  // Shut down gracefully, as a deploy would.
  await server.stop("SIGTERM");

  // The call doesn't need the server: chat still gets through.
  await alice.getByRole("button", { name: "Show chat" }).click();
  await alice.getByRole("textbox", { name: "Message" }).fill("Still there?");
  await alice.keyboard.press("Enter");
  await expect(bob.getByRole("button", { name: "Show chat (1 unread)" })).toBeVisible();

  await server.start();
  await expect.poll(() => server.activeCalls(), { timeout: 20_000 }).toBe(1);

  // Both rejoined the room without setting the call up again.
  for (const page of [alice, bob]) {
    await expect(page.locator(".call-status")).toHaveText("Connected");
    expect(await peerConnectionCount(page)).toBe(1);
  }

  // And the new server knows about the call: when Bob leaves, Alice is told.
  await bob.getByRole("button", { name: "Leave call" }).click();
  await expect(alice.getByRole("heading", { name: "Waiting for someone to join" })).toBeVisible();
});

test("someone left alone after a server crash goes back to waiting", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await joinOwnServer(newPerson, room);
  const bob = await joinOwnServer(newPerson, room);
  await expectConnected(alice);
  await expectConnected(bob);

  await server.stop("SIGKILL");
  // Bob closes the tab while the server is down, so it can't tell Alice.
  await bob.close();
  await server.start();

  await expect(alice.getByRole("heading", { name: "Waiting for someone to join" })).toBeVisible({
    timeout: 20_000,
  });

  // The next person to join connects with Alice as usual.
  const carol = await joinOwnServer(newPerson, room);
  await expectConnected(alice);
  await expectConnected(carol);
});
