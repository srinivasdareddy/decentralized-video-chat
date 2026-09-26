import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

let roomCounter = 0;
/** A room name no other test (or earlier run) uses. */
function uniqueRoom(): string {
  return `e2e-${process.pid}-${Date.now()}-${++roomCounter}`;
}

async function join(newPerson: () => Promise<Page>, room: string): Promise<Page> {
  const page = await newPerson();
  await page.goto(`/join/${room}`);
  return page;
}

async function expectConnected(page: Page): Promise<void> {
  await expect(page.locator(".call-status")).toHaveText("Connected", { timeout: 20_000 });
  // Real frames from the other side are rendering.
  await expect
    .poll(() =>
      page.locator(".remote-video").evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBeGreaterThan(0);
}

test("two people can join a call, see each other, and chat", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await join(newPerson, room);
  await expect(alice.getByRole("heading", { name: "Waiting for someone to join" })).toBeVisible();
  await expect(alice.locator(".invite-url")).toHaveText(new RegExp(`/join/${room}$`));

  const bob = await join(newPerson, room);
  await expectConnected(alice);
  await expectConnected(bob);

  await alice.getByRole("button", { name: "Show chat" }).click();
  const hostile = 'Hi <img src=x onerror="window.pwned=true"> see https://example.com/page.';
  await alice.getByRole("textbox", { name: "Message" }).fill(hostile);
  await alice.keyboard.press("Enter");
  await expect(alice.locator(".chat-message.is-own")).toHaveCount(1);

  // Bob gets a notification and an unread badge, then reads the message.
  await expect(bob.locator(".toast")).toContainText("New message");
  await bob.getByRole("button", { name: "Show chat (1 unread)" }).click();
  const received = bob.locator(".chat-message.is-peer");
  await expect(received).toContainText('<img src=x onerror="window.pwned=true">');
  await expect(received.getByRole("link")).toHaveAttribute("href", "https://example.com/page");
  await expect(received.locator("img")).toHaveCount(0);
  expect(await bob.evaluate(() => "pwned" in window)).toBe(false);
});

test("the other person sees when you mute", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await join(newPerson, room);
  const bob = await join(newPerson, room);
  await expectConnected(alice);
  await expectConnected(bob);

  await alice.getByRole("button", { name: "Turn off microphone" }).click();
  await expect(alice.getByRole("button", { name: "Turn on microphone" })).toBeVisible();
  await expect(bob.locator(".stage-badge")).toHaveText("Muted");

  await alice.getByRole("button", { name: "Turn off camera" }).click();
  await expect(bob.getByText("Their camera is off")).toBeVisible();
});

test("a call holds two people", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await join(newPerson, room);
  const bob = await join(newPerson, room);
  await expectConnected(alice);

  const carol = await join(newPerson, room);
  await expect(carol.getByRole("heading", { name: "This call is full" })).toBeVisible();
  // The call carries on.
  await expect(bob.locator(".call-status")).toHaveText("Connected");
});

test("when someone leaves, the other waits and can talk to someone new", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await join(newPerson, room);
  const bob = await join(newPerson, room);
  await expectConnected(alice);

  await bob.getByRole("button", { name: "Leave call" }).click();
  await expect(bob).toHaveURL(/\/newcall$/);
  await expect(alice.locator(".toast")).toHaveText("The other person left the call.");
  await expect(alice.getByRole("heading", { name: "Waiting for someone to join" })).toBeVisible();

  // No reload needed: the same page connects to the next person.
  const carol = await join(newPerson, room);
  await expectConnected(alice);
  await expectConnected(carol);
});
