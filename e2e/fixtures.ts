import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

interface Fixtures {
  /** Opens a page in its own browser context: a separate person in a call. */
  newPerson: () => Promise<Page>;
  /** Content-Security-Policy violations seen on any page during the test. */
  cspViolations: string[];
}

/**
 * Reports every policy violation to the test, even from pages that have
 * since navigated away.
 */
export async function recordViolations(
  context: BrowserContext,
  violations: string[],
): Promise<void> {
  await context.exposeBinding("__reportCspViolation", (_source, violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation?: (text: string) => void })
        .__reportCspViolation;
      report?.(
        `${event.effectiveDirective} blocked ${event.blockedURI || "inline code"} on ${location.pathname}`,
      );
    });
  });
}

/** Every test fails if the Content-Security-Policy blocked anything. */
export const test = base.extend<Fixtures>({
  // Playwright requires the destructuring pattern even with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  cspViolations: async ({}, use) => {
    const violations: string[] = [];
    await use(violations);
    expect(violations, "Content-Security-Policy violations").toEqual([]);
  },
  context: async ({ context, cspViolations }, use) => {
    await recordViolations(context, cspViolations);
    await use(context);
  },
  newPerson: async ({ browser, cspViolations }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      await recordViolations(context, cspViolations);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };
