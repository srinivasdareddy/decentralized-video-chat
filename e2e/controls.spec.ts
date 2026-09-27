import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { expectConnected, join, uniqueRoom } from "./helpers.ts";

/** The label of the camera shown in the self-view, e.g. "fake_device_0". */
function selfViewCamera(page: Page): Promise<string> {
  return page
    .locator(".self-view-video")
    .evaluate(
      (video: HTMLVideoElement) =>
        (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.label ?? "",
    );
}

/** Whether new frames of the other person's video keep arriving. */
async function expectVideoPlaying(page: Page): Promise<void> {
  const video = page.locator(".remote-video");
  const frames = () =>
    video.evaluate(
      (element: HTMLVideoElement) => element.getVideoPlaybackQuality().totalVideoFrames,
    );
  const before = await frames();
  await expect.poll(frames).toBeGreaterThan(before);
}

test("you can switch cameras mid-call, and the choice is remembered", async ({ newPerson }) => {
  const room = uniqueRoom();
  const alice = await join(newPerson, room);
  const bob = await join(newPerson, room);
  await expectConnected(alice);
  await expectConnected(bob);
  await expect.poll(() => selfViewCamera(alice)).toBe("fake_device_0");

  await alice.getByRole("button", { name: "Settings" }).click();
  const settings = alice.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("combobox", { name: "Camera" }).selectOption({ label: "fake_device_2" });
  await expect.poll(() => selfViewCamera(alice)).toBe("fake_device_2");
  await alice.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Bob keeps seeing Alice without the call being set up again.
  await expect(bob.locator(".call-status")).toHaveText("Connected");
  await expectVideoPlaying(bob);

  // The choice survives a reload (after confirming leaving the call).
  alice.once("dialog", (dialog) => void dialog.accept());
  await alice.reload();
  await expectConnected(alice);
  await expect.poll(() => selfViewCamera(alice)).toBe("fake_device_2");
});

test("keyboard shortcuts turn the microphone and camera on and off", async ({ newPerson }) => {
  const alice = await join(newPerson, uniqueRoom());
  const microphone = alice.getByRole("button", { name: /microphone/ });
  const camera = alice.getByRole("button", { name: /camera/ });
  await expect(microphone).toHaveAccessibleName("Turn off microphone");
  await expect(microphone).toHaveAttribute("aria-keyshortcuts", "Control+D");

  await alice.keyboard.press("Control+d");
  await expect(microphone).toHaveAccessibleName("Turn on microphone");
  await alice.keyboard.press("Control+e");
  await expect(camera).toHaveAccessibleName("Turn on camera");
  await alice.keyboard.press("Control+d");
  await expect(microphone).toHaveAccessibleName("Turn off microphone");
});

test("going back mid-call asks before leaving", async ({ newPerson }) => {
  const room = uniqueRoom();
  // Arrive from the new-call page, so there's a page to go back to.
  const alice = await newPerson();
  await alice.goto("/newcall");
  await alice.getByRole("textbox", { name: "Call name" }).fill(room);
  await alice.getByRole("button", { name: "Start call" }).click();
  const bob = await join(newPerson, room);
  await expectConnected(alice);

  const confirm = alice.getByRole("dialog", { name: "Leave the call?" });
  // Every time, even going back again the moment the dialog closes (the
  // dialog's close event arrives late, and once cancelled the next one).
  for (let round = 0; round < 5; round++) {
    await alice.evaluate(() => history.back());
    await confirm.getByRole("button", { name: "Stay" }).click();
    await expect(confirm).toBeHidden();
  }
  await expect(alice).toHaveURL(new RegExp(`/join/${room}$`));
  await expect(alice.locator(".call-status")).toHaveText("Connected");

  await alice.evaluate(() => history.back());
  await confirm.getByRole("button", { name: "Leave call" }).click();
  await expect(alice).toHaveURL(/\/newcall$/);
  await expect(bob.getByRole("heading", { name: "Waiting for someone to join" })).toBeVisible();
});
