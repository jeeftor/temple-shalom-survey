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

test("already-submitted Start over button clears state and reloads survey", async ({ page }) => {
  // Simulate a prior submission
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("ts_survey_submitted_2026", "1");
    localStorage.setItem("ts_survey_draft_2026", JSON.stringify({
      data: { q_contact_name: "Should be gone" },
      pageNo: 6,
      savedAt: Date.now(),
    }));
    localStorage.setItem("ts_survey_page_2026", "6");
  });

  await page.reload();

  // Should see the "already submitted" notice, not the survey
  await expect(page.locator("text=You've already submitted this survey")).toBeVisible();
  await expect(page.locator(".sd-root-modern")).toHaveCount(0);

  // The Start over button should be clickable (this was the bug — wrong element got the listener)
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#startOverSubmittedBtn").click();

  // Page reloads; survey should be visible and empty (no draft restored)
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator("#sectionSelect")).toHaveValue("0");

  // localStorage should be cleared
  const submitted = await page.evaluate(() => localStorage.getItem("ts_survey_submitted_2026"));
  expect(submitted).toBeNull();
  const draft = await page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"));
  expect(draft).toBeNull();
  const savedPage = await page.evaluate(() => localStorage.getItem("ts_survey_page_2026"));
  expect(savedPage).toBeNull();
});

// ── Preview-before-submit flow ────────────────────────────────────────────────
// All worker calls are intercepted so these tests never touch production.

async function interceptWorker(page, calls) {
  await page.route("**/temple-shalom-survey.jeffstein.workers.dev/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push({ method: req.method(), path: url.pathname, body: req.postDataJSON?.() ?? null });
    if (url.pathname === "/submit") {
      return route.fulfill({ json: { success: true, response_id: "test-uuid" } });
    }
    if (url.pathname === "/draft") {
      return route.fulfill({ json: { success: true, draft_id: "testdraft", expires_at: new Date(Date.now() + 86400000).toISOString() } });
    }
    return route.fulfill({ json: { success: true } });
  });
}

test("Preview button shows review screen, saves draft, and Complete submits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile skips preview — tested separately");
  const calls = [];
  await interceptWorker(page, calls);

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  // Answer one question so the draft save has data
  await goToSection(page, 0);
  await page.locator('[data-name="q3_ada"] label').first().click();

  // Go to the last section — the nav button should be "Review & Submit"
  await goToSection(page, sections.length - 1);
  const previewBtn = page.locator('input[value="Review & Submit"], button:has-text("Review & Submit")');
  await expect(previewBtn.first()).toBeVisible();
  await previewBtn.first().click();

  // Preview state: custom section nav and action bar are hidden
  await expect(page.locator("#sectionNav")).toBeHidden();
  await expect(page.locator("#actionBar")).toBeHidden();

  // Floating submit bar is visible at the top of the preview
  await expect(page.locator("#previewSubmitBar")).toBeVisible();
  await expect(page.locator("#previewSubmitBtn")).toBeVisible();

  // The force-save draft POST fired with _preview flag
  await expect.poll(() =>
    calls.some(c => c.method === "POST" && c.path === "/draft" && c.body?._preview === true)
  ).toBe(true);

  // Complete from the preview screen via the floating top submit button
  await page.locator("#previewSubmitBtn").click();

  await expect.poll(() => calls.some(c => c.method === "POST" && c.path === "/submit")).toBe(true);
  await expect(page.locator("#submitStatus")).toHaveClass(/success/);
  await expect.poll(() => calls.some(c => c.method === "DELETE" && c.path === "/draft")).toBe(true);

  // Ghost-draft regression guard: once submit succeeded (timers cleared,
  // DELETE sent), no NEW draft POST may fire. A debounced save can still
  // land between the submit request and its response, so we snapshot here.
  const baseline = calls.length;
  await page.waitForTimeout(3000);
  const lateDrafts = calls.slice(baseline).filter(c => c.method === "POST" && c.path === "/draft");
  expect(lateDrafts).toEqual([]);
});

test("Mobile goes straight to submit without preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only test");
  const calls = [];
  await interceptWorker(page, calls);

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  // Answer one question
  await goToSection(page, 0);
  await page.locator('[data-name="q3_ada"] label').first().click();

  // Go to the last section — should be "Submit Survey", not "Review & Submit"
  await goToSection(page, sections.length - 1);
  const completeBtn = page.locator('.sd-navigation__complete:has-text("Submit Survey"), input[value="Submit Survey"]').first();
  await expect(completeBtn).toBeVisible();

  // No preview submit bar should be visible
  await expect(page.locator("#previewSubmitBar")).toBeHidden();

  // Complete goes straight to submit
  await completeBtn.first().click();

  await expect.poll(() => calls.some(c => c.method === "POST" && c.path === "/submit")).toBe(true);
  await expect(page.locator("#submitStatus")).toHaveClass(/success/);
});

test("Edit from preview restores section navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile has no preview");
  const calls = [];
  await interceptWorker(page, calls);

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, 0);
  await page.locator('[data-name="q3_ada"] label').first().click();
  await goToSection(page, sections.length - 1);

  await page.locator('input[value="Review & Submit"], button:has-text("Review & Submit")').first().click();
  await expect(page.locator("#sectionNav")).toBeHidden();

  // Go back to editing via the first Edit button on the preview
  await page.locator('input[value="Edit"], button:has-text("Edit")').first().click();

  // Custom nav must come back
  await expect(page.locator("#sectionNav")).toBeVisible();
  await expect(page.locator("#actionBar")).toBeVisible();
});

test("Start over from draft-notice clears survey answers", async ({ page }) => {
  // Pre-seed a local draft so the survey has data loaded
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("ts_survey_draft_2026", JSON.stringify({
      data: { q3_ada: "sometimes", q_contact_name: "Draft User" },
      pageNo: 0,
      savedAt: Date.now(),
    }));
  });
  await page.reload();
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  // Simulate a server draft found via ?draft=XXXX by injecting the draft notice
  // and making it visible (mirrors what setDraftPromptVisible(true) does)
  await page.evaluate(() => {
    document.getElementById("draftMessage").textContent = "A saved draft was found. Would you like to resume?";
    document.getElementById("draftNotice").hidden = false;
    document.getElementById("surveyContainer").hidden = true;
    document.getElementById("actionBar").hidden = true;
  });

  await expect(page.locator("#draftNotice")).toBeVisible();
  await expect(page.locator("#startOverBtn")).toBeVisible();

  // Click Start over (accept the confirm dialog)
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#startOverBtn").click();

  // Survey should be visible again, on page 0, with no answers
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await expect(page.locator("#sectionSelect")).toHaveValue("0");

  // The previously-loaded draft answers should be gone from the survey
  const adaInput = page.locator('[data-name="q3_ada"] input:checked');
  await expect(adaInput).toHaveCount(0);

  // localStorage draft should be cleared
  const draft = await page.evaluate(() => localStorage.getItem("ts_survey_draft_2026"));
  expect(draft).toBeNull();
});
