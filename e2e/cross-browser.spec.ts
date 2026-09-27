import fs from "node:fs";
import { firefox } from "@playwright/test";
import { expect, recordViolations, test } from "./fixtures.ts";
import { expectConnected, join, uniqueRoom } from "./helpers.ts";

// CI installs Firefox for this; locally: npx playwright install firefox
test.skip(!fs.existsSync(firefox.executablePath()), "Firefox isn't installed");

test("Chrome and Firefox can call each other", async ({ newPerson, baseURL, cspViolations }) => {
  const browser = await firefox.launch({
    firefoxUserPrefs: {
      // A synthetic camera and microphone, allowed without asking.
      "media.navigator.streams.fake": true,
      "media.navigator.permission.disabled": true,
      // Real host addresses, since Chrome can't always resolve mDNS names in CI.
      "media.peerconnection.ice.obfuscate_host_addresses": false,
    },
  });
  try {
    const context = await browser.newContext({ baseURL });
    await recordViolations(context, cspViolations);
    const room = uniqueRoom();
    const chrome = await join(newPerson, room);
    const firefoxPage = await context.newPage();
    await firefoxPage.goto(`/join/${room}`);

    await expectConnected(chrome);
    await expectConnected(firefoxPage);

    // Chat both ways over the data channel.
    await chrome.getByRole("button", { name: "Show chat" }).click();
    await chrome.getByRole("textbox", { name: "Message" }).fill("Hello from Chrome");
    await chrome.keyboard.press("Enter");
    await firefoxPage.getByRole("button", { name: "Show chat (1 unread)" }).click();
    await expect(firefoxPage.locator(".chat-message.is-peer")).toHaveText("Hello from Chrome");
    await firefoxPage.getByRole("textbox", { name: "Message" }).fill("Hello from Firefox");
    await firefoxPage.keyboard.press("Enter");
    await expect(chrome.locator(".chat-message.is-peer")).toHaveText("Hello from Firefox");

    // Mute state crosses over too.
    await firefoxPage.getByRole("button", { name: "Turn off microphone" }).click();
    await expect(chrome.locator(".stage-badge")).toHaveText("Muted");
  } finally {
    await browser.close();
  }
});
