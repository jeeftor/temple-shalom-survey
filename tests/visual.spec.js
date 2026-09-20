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

// ── Mobile matrix label tests ────────────────────────────────────────────────
// These verify the custom label injection (wrapMatrixTables) that replaces
// the hidden <thead> on mobile. Regression guards for off-by-one shifts and
// duplicate labels from SurveyJS's built-in responsive rendering.

async function collectMatrixLabels(page) {
  return page.evaluate(() => {
    const matrices = [...document.querySelectorAll(".sd-matrix")];
    return matrices.map(matrix => {
      const headerCells = [...matrix.querySelectorAll("thead th")];
      const headerLabels = headerCells
        .map(th => th.textContent.trim())
        .filter(t => t);

      const rows = [...matrix.querySelectorAll("tr")];
      const rowLabels = rows.map(tr =>
        [...tr.querySelectorAll(".mobile-col-label")].map(el => el.textContent.trim())
      ).filter(r => r.length > 0);

      const injectedLabels = [...matrix.querySelectorAll(".mobile-col-label")]
        .map(el => el.textContent.trim());

      const responsiveTitles = [...matrix.querySelectorAll(".sd-table__responsive-title, .sd-matrix__responsive-title")]
        .filter(el => getComputedStyle(el).display !== "none")
        .map(el => el.textContent.trim());

      const radioLabels = [...matrix.querySelectorAll(".sd-radio__label")]
        .filter(el => getComputedStyle(el).display !== "none")
        .map(el => el.textContent.trim());

      return { headerLabels, rowLabels, injectedLabels, responsiveTitles, radioLabels };
    });
  });
}

function assertMatrixLabels(matrixData) {
  for (const matrix of matrixData) {
    expect(matrix.injectedLabels.length).toBeGreaterThan(0);
    for (const rowLabel of matrix.rowLabels) {
      expect(rowLabel).toEqual(matrix.headerLabels);
    }
    expect(matrix.responsiveTitles).toEqual([]);
    expect(matrix.radioLabels).toEqual([]);
  }
}

test("mobile matrix labels match column headers across all sections", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only — desktop keeps the table layout");

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  for (let index = 0; index < sections.length; index++) {
    await goToSection(page, index);
    await expect(page.locator(".sd-page__title")).toContainText(sections[index]);
    await page.waitForTimeout(500);

    const matrixData = await collectMatrixLabels(page);
    if (matrixData.length === 0) continue;

    // Assert each matrix on this section has correct, non-duplicated labels
    expect(matrixData.length).toBeGreaterThan(0);
    assertMatrixLabels(matrixData);
  }
});

test("mobile matrix labels stay correct after re-render (navigate away and back)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only — desktop keeps the table layout");

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();

  // Section 5 (Member Satisfaction) has the most matrix questions
  const targetSection = 4;
  await goToSection(page, targetSection);
  await expect(page.locator(".sd-page__title")).toContainText("Member Satisfaction");
  await page.waitForTimeout(500);

  // First pass: collect labels
  const firstPass = await collectMatrixLabels(page);
  expect(firstPass.length).toBeGreaterThan(0);
  assertMatrixLabels(firstPass);

  // Navigate away to Section 1 and back — triggers SurveyJS re-render
  await goToSection(page, 0);
  await expect(page.locator(".sd-page__title")).toContainText("Demographics");
  await page.waitForTimeout(300);

  await goToSection(page, targetSection);
  await expect(page.locator(".sd-page__title")).toContainText("Member Satisfaction");
  await page.waitForTimeout(500);

  // Second pass: labels must still be correct, no duplicates from re-render
  const secondPass = await collectMatrixLabels(page);
  expect(secondPass.length).toBeGreaterThan(0);
  assertMatrixLabels(secondPass);

  // Same number of matrices and labels (no accumulation from re-render)
  expect(secondPass.length).toBe(firstPass.length);
  for (let i = 0; i < firstPass.length; i++) {
    expect(secondPass[i].injectedLabels).toEqual(firstPass[i].injectedLabels);
  }
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
  await expect(page.getByText("In the past year or in the coming year, have your child(ren) under 18", { exact: false })).toBeVisible();
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

test("Submit Now button skips preview and submits directly", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop-only — mobile has no preview");
  const calls = [];
  await interceptWorker(page, calls);

  await page.goto("/");
  await expect(page.locator(".sd-root-modern")).toBeVisible();
  await goToSection(page, 0);
  await page.locator('[data-name="q3_ada"] label').first().click();
  await goToSection(page, sections.length - 1);

  // "Submit Now" button should be visible in the nav row
  await expect(page.locator("#submitNowNavBtn")).toBeVisible();

  // Click it — should go straight to submit, no preview
  await page.locator("#submitNowNavBtn").click();

  await expect.poll(() => calls.some(c => c.method === "POST" && c.path === "/submit")).toBe(true);
  await expect(page.locator("#submitStatus")).toHaveClass(/success/);
  // No preview draft should have been saved
  expect(calls.some(c => c.method === "POST" && c.path === "/draft" && c.body?._preview === true)).toBe(false);
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

// ── Admin page smoke tests ───────────────────────────────────────────────────
// Mock /results so tests never touch production data. Verifies all tabs render
// without JS errors and the CSV export button is wired up.

const MOCK_KEY = "test-export-key";

function mockResponses() {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  return {
    count: 3,
    responses: [
      {
        id: 1, response_id: "r1", timestamp: now, session_id: "s1",
        submission_number: 1, previous_response_id: null, survey_version: "abc",
        ip_country: "US", cf_ray: "ray1", completion_seconds: 300,
        sections_answered: ["Section 1: Demographics", "Section 2: Your Jewish Journey", "Section 3: Worship & Programs"],
        user_agent: "Mozilla/5.0", referrer: "https://example.com",
        device_type: "desktop", browser: "Chrome", os: "macOS",
        screen_size: "1920x1080", viewport_size: "1440x900", started_at: now,
        answers: {
          q_nps: 9,
          q7_jewish_growth: "I love the community here.",
          q25_service_comments: "Services are meaningful.",
          q28_final_comments: "Keep up the great work.",
          q_contact_name: "Test Member",
          q_contact_email: "test@example.com",
          q_contact_request: "yes",
        },
      },
      {
        id: 2, response_id: "r2", timestamp: dayAgo, session_id: "s2",
        submission_number: 1, previous_response_id: null, survey_version: "abc",
        ip_country: "US", cf_ray: "ray2", completion_seconds: 120,
        sections_answered: ["Section 1: Demographics", "Section 2: Your Jewish Journey"],
        user_agent: "Mozilla/5.0 (iPhone)", referrer: "",
        device_type: "mobile", browser: "Safari", os: "iOS",
        screen_size: "390x844", viewport_size: "390x844", started_at: dayAgo,
        answers: {
          q_nps: 7,
          q7_jewish_growth: "Could use more programming.",
          q28_final_comments: "",
        },
      },
      {
        id: 3, response_id: "r3", timestamp: twoDaysAgo, session_id: "s1",
        submission_number: 2, previous_response_id: "r1", survey_version: "abc",
        ip_country: "US", cf_ray: "ray3", completion_seconds: 240,
        sections_answered: ["Section 1: Demographics", "Section 2: Your Jewish Journey", "Section 3: Worship & Programs", "Section 4: Social Engagement & Interests"],
        user_agent: "Mozilla/5.0", referrer: "",
        device_type: "desktop", browser: "Firefox", os: "Linux",
        screen_size: "1920x1080", viewport_size: "1280x720", started_at: twoDaysAgo,
        answers: {
          q_nps: 10,
          q25_service_comments: "Wonderful experience.",
          q28_final_comments: "No notes.",
        },
      },
    ],
  };
}

async function setupAdminPage(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  });

  // Mock /results and /export
  await page.route("**/temple-shalom-survey.jeffstein.workers.dev/results**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("key") !== MOCK_KEY) {
      return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
    }
    return route.fulfill({ status: 200, json: mockResponses() });
  });
  await page.route("**/temple-shalom-survey.jeffstein.workers.dev/export**", async route => {
    return route.fulfill({ status: 200, body: "id,timestamp\r\n1,2026-01-01\r\n", headers: { "Content-Type": "text/csv" } });
  });

  return errors;
}

test("admin page renders all tabs without JS errors", async ({ page }) => {
  const errors = await setupAdminPage(page);

  await page.goto(`/admin.html?key=${MOCK_KEY}`);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 10000 });

  // Stats row should have cards
  await expect(page.locator(".stat-card").first()).toBeVisible();

  // Dashboard tab is active by default
  await expect(page.locator("#tab-dashboard")).toHaveClass(/active/);

  // Switch through each tab and verify content renders
  const tabs = [
    { name: "trends", contentId: "trendsContent" },
    { name: "comments", contentId: "commentsContent" },
    { name: "followup", contentId: "followupContent" },
    { name: "responses", contentId: "respBody" },
  ];

  for (const tab of tabs) {
    const btn = page.locator(".tab-bar button", { hasText: new RegExp(tab.name === "trends" ? "Trends" : tab.name === "comments" ? "Comments" : tab.name === "followup" ? "Follow-up" : "Individual") });
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ force: true });
    await expect(page.locator(`#tab-${tab.name}`)).toHaveClass(/active/);
    await expect(page.locator(`#${tab.contentId}`)).not.toBeEmpty();
    await page.waitForTimeout(200);
  }

  // Back to dashboard — charts should have rendered
  const dashBtn = page.locator(".tab-bar button", { hasText: "Dashboard" });
  await dashBtn.scrollIntoViewIfNeeded();
  await dashBtn.click({ force: true });
  await expect(page.locator("#tab-dashboard")).toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test("admin CSV export button is wired up after auth", async ({ page }) => {
  await setupAdminPage(page);

  await page.goto(`/admin.html?key=${MOCK_KEY}`);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 10000 });

  // Header export button should be visible and have a valid href
  await expect(page.locator("#hdrExport")).toBeVisible();
  const href = await page.locator("#hdrCsvBtn").getAttribute("href");
  expect(href).toContain("/export?key=");
  expect(href).toContain(MOCK_KEY);
});

test("admin comments tab shows comments and copy button", async ({ page }) => {
  await setupAdminPage(page);

  await page.goto(`/admin.html?key=${MOCK_KEY}`);
  await expect(page.locator("#dashboard")).toBeVisible({ timeout: 10000 });

  // Go to Comments tab
  await page.locator(".tab-bar button", { hasText: "Comments" }).click();
  await expect(page.locator("#tab-comments")).toHaveClass(/active/);

  // Copy all button should be present
  await expect(page.locator("button", { hasText: "Copy all comments for LLM" })).toBeVisible();

  // Comment groups should be rendered (we have 3 comment questions with data)
  const groupCount = await page.locator(".comment-group").count();
  expect(groupCount).toBeGreaterThan(0);

  // At least one comment item should be visible
  await expect(page.locator(".comment-item").first()).toBeVisible();
});
