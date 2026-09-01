const { test, expect } = require("@playwright/test");

const sections = [
  "Demographics",
  "Your Jewish Journey",
  "Engagement at Temple Shalom",
  "Member Satisfaction",
  "Financial & Giving",
  "Communications Preferences",
  "Final Comments",
];

async function expectNoRenderingErrors(page) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    matrices: [...document.querySelectorAll(".sd-matrix")].map(matrix => {
      const rect = matrix.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }),
  }));

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  for (const matrix of metrics.matrices) {
    expect(matrix.left).toBeGreaterThanOrEqual(-1);
    expect(matrix.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(matrix.width).toBeGreaterThan(0);
  }

  const questions = page.locator(".sd-question");
  await expect(questions.first()).toBeVisible();
  await expect(page.locator("header")).toBeVisible();
  await expect(page.locator("#sectionNav")).toBeVisible();
}

async function goToSection(page, index) {
  const select = page.locator("#sectionSelect");
  if (await select.isVisible()) {
    await select.selectOption(String(index));
  } else {
    await page.locator(".nav-pill").nth(index).click();
  }
}

async function captureVisual(page, testInfo, name) {
  if (!process.env.CI) {
    await expect(page).toHaveScreenshot(name, { fullPage: true });
    return;
  }

  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("section navigation adapts without duplicate progress dots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator(".sd-progress-buttons")).toHaveCount(0);
  await expect(page.locator("#sectionSelect option")).toHaveCount(sections.length);
  await expect(page.locator("#sectionSelect option").nth(5)).toContainText("Communications");
  await goToSection(page, 5);
  await expect(page.locator(".sd-page__title")).toContainText("Communications Preferences");
  await expect(page.locator('[data-name="q_service_announcements_length"]')).toBeVisible();
  await expect(page.locator('[data-name="q_service_announcements_comments"]')).toBeVisible();
});

test("survey sections render without clipping", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await page.locator("#versionFooter").evaluate(element => { element.style.visibility = "hidden"; });

  for (let index = 0; index < sections.length; index++) {
    await goToSection(page, index);
    await expect(page.locator(".sd-page__title")).toContainText(sections[index]);
    await expectNoRenderingErrors(page);
    await captureVisual(page, testInfo, `survey-${index + 1}-${sections[index].toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
  }

  expect(errors).toEqual([]);
  await testInfo.attach("survey-url", { body: Buffer.from(page.url()), contentType: "text/plain" });
});

test("unfinished responses can be saved and resumed", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, sections.length - 1);
  await page.locator('[data-name="q_contact"] input').fill("Test Member, test@example.com");

  await expect.poll(() => page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"))).not.toBeNull();
  await page.reload();
  await expect(page.locator("#draftNotice")).toBeVisible();
  await expect(page.locator("#surveyContainer")).toBeHidden();
  await captureVisual(page, testInfo, "draft-resume-prompt.png");
  await page.locator("#resumeDraftBtn").click();
  await expect(page.locator('[data-name="q_contact"] input')).toHaveValue("Test Member, test@example.com");
  await expect(page.locator('[data-name="q_contact_request"]')).toBeVisible();
  await expect(page.locator("#sectionSelect")).toHaveValue(String(sections.length - 1));

  await expect.poll(() => page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"))).not.toBeNull();
  await page.reload();
  await page.locator("#startOverBtn").click();
  await expect(page.locator('[data-name="q_contact"]')).toHaveCount(0);
  await expect(page.locator("#sectionSelect")).toHaveValue("0");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"))).toBeNull();
});

test("expired drafts are discarded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("ts_survey_draft_2026", JSON.stringify({ data: { q_contact: "Old draft" }, pageNo: 6, savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }));
  });
  await page.reload();
  await expect(page.locator("#draftNotice")).toBeHidden();
  await expect(page.locator("#surveyContainer")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"))).toBeNull();
});

test("contact request appears after identification", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, sections.length - 1);

  const contact = page.locator('[data-name="q_contact"] input');
  const request = page.locator('[data-name="q_contact_request"]');
  await expect(contact).toBeVisible();
  await expect(request).toBeHidden();
  await contact.fill("Test Member, test@example.com");
  await expect(request).toBeVisible();
  await contact.fill("");
  await expect(request).toBeHidden();
});

test("print view renders every section", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Print inspection runs once in the desktop project");

  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });

  await page.goto("/print.html");
  await expect(page.locator(".section")).toHaveCount(sections.length);
  await expect(page.locator(".question").first()).toBeVisible();
  await expect(page.locator(".branch-note")).toHaveCount(0);
  await expect(page.getByText("Only answer if", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Does the lack of ADA accessibility limit", { exact: false })).toBeVisible();
  await expect(page.getByText("has or do you expect your child(ren) under 18", { exact: false })).toBeVisible();
  await expect(page.getByText("Contact information (optional):", { exact: false })).toBeVisible();
  await expect(page.getByText("Would you like someone from Temple Shalom to contact you", { exact: false })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await captureVisual(page, testInfo, "survey-print.png");

  const pdfPath = testInfo.outputPath("survey-print.pdf");
  await page.pdf({ path: pdfPath, format: "Letter", printBackground: true });
  await testInfo.attach("survey-print.pdf", { path: pdfPath, contentType: "application/pdf" });
  expect(errors).toEqual([]);
});
