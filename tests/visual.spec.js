const { test, expect } = require("@playwright/test");

const sections = [
  "Demographics",
  "Your Jewish Journey",
  "Worship & Programs",
  "Social Engagement & Interests",
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

test("section navigation adapts without duplicate progress dots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator(".sd-progress-buttons")).toHaveCount(0);
  await expect(page.locator("#sectionSelect option")).toHaveCount(sections.length);
  await expect(page.locator("#sectionSelect option").nth(6)).toContainText("Communications");
  await goToSection(page, 6);
  await expect(page.locator(".sd-page__title")).toContainText("Communications Preferences");
  await expect(page.locator('[data-name="q_service_announcements_length"]')).toBeVisible();
  await expect(page.locator('[data-name="q_service_announcements_comments"]')).toBeVisible();
});

test("survey sections render without clipping", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  for (let index = 0; index < sections.length; index++) {
    await goToSection(page, index);
    await expect(page.locator(".sd-page__title")).toContainText(sections[index]);
    await expectNoRenderingErrors(page);
  }

  expect(errors).toEqual([]);
});

test("drafts are silently restored on reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, sections.length - 1);

  // Fill contact fields to create a draft (press Tab to trigger SurveyJS value capture)
  await page.locator('[data-name="q_contact_name"] input').fill("Test Member");
  await page.keyboard.press("Tab");
  await page.locator('[data-name="q_contact_email"] input').fill("test@example.com");
  await page.keyboard.press("Tab");

  // Wait for draft to be saved with both values
  await expect.poll(async () => {
    const raw = await page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"));
    try {
      const draft = JSON.parse(raw);
      return draft?.data?.q_contact_name === "Test Member" && draft?.data?.q_contact_email === "test@example.com";
    } catch {
      return false;
    }
  }).toBe(true);

  await page.reload();

  // Wait for survey to fully render before checking values
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator('[data-name="q_contact_name"]')).toBeVisible();
  await expect(page.locator('[data-name="q_contact_email"]')).toBeVisible();
  // Give SurveyJS time to restore values into the inputs
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-name="q_contact_name"] input')).toHaveValue("Test Member");
  await expect(page.locator('[data-name="q_contact_email"] input')).toHaveValue("test@example.com");
  await expect(page.locator("#sectionSelect")).toHaveValue(String(sections.length - 1));
});

test("expired drafts are discarded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("ts_survey_draft_2026", JSON.stringify({ data: { q_contact_name: "Old draft" }, pageNo: 6, savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }));
  });
  await page.reload();
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"))).toBeNull();
});

test("contact fields render on final section", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, sections.length - 1);

  // Contact fields are always visible
  await expect(page.locator('[data-name="q_contact_name"]')).toBeVisible();
  await expect(page.locator('[data-name="q_contact_email"]')).toBeVisible();
  await expect(page.locator('[data-name="q_contact_phone"]')).toBeVisible();

  // Contact request only appears when a contact field is filled
  await expect(page.locator('[data-name="q_contact_request"]')).toBeHidden();
  await page.locator('[data-name="q_contact_name"] input').fill("Test Member");
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-name="q_contact_request"]')).toBeVisible();
});

test("undo button reverts last change", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  // Answer a radiogroup question (Q3: ADA accessibility)
  await goToSection(page, 0);
  // Click the first radio option by clicking its label
  const adaQuestion = page.locator('[data-name="q3_ada"]');
  await adaQuestion.locator("label").first().click();

  // Undo button should appear (wait up to 10s)
  await expect(page.locator("#undoBtn")).toHaveClass(/visible/, { timeout: 10000 });

  // Click undo
  await page.locator("#undoBtn").click();

  // Undo button should hide
  await expect(page.locator("#undoBtn")).not.toHaveClass(/visible/);
});

test("logo is visible in header", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator("header img")).toBeVisible();
  const src = await page.locator("header img").getAttribute("src");
  expect(src).toContain("logo");
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

  // Section headers are present
  for (let i = 0; i < sections.length; i++) {
    await expect(page.locator(".section-header").nth(i)).toContainText(sections[i]);
  }

  // Conditional questions render plainly (no branch notes)
  await expect(page.locator(".branch-note")).toHaveCount(0);
  await expect(page.getByText("Only answer if", { exact: false })).toHaveCount(0);

  // Key content is present
  await expect(page.getByText("Does the lack of ADA accessibility limit", { exact: false })).toBeVisible();
  await expect(page.getByText("has or do you expect your child(ren) under 18", { exact: false })).toBeVisible();
  await expect(page.getByText("Contact information (optional)", { exact: false })).toBeVisible();
  await expect(page.getByText("Would you like someone from Temple Shalom to contact you", { exact: false })).toBeVisible();

  // Logo in print header
  await expect(page.locator("header img")).toBeVisible();

  expect(errors).toEqual([]);
});
