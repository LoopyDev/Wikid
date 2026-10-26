# Browser tests

These tests use Wikid in a real browser (Chromium, through [Playwright](https://playwright.dev)) against a running stack: signing in, writing and saving pages, two people editing together, databases, and the sidebar.

## Running them

Start a stack with the demo users (the default), then run the tests from the repo root:

```bash
docker compose -p wikid-dockertest -f docker-compose.yml up -d --build --wait
# Optional: prefix with ANTHROPIC_API_KEY=not-a-real-key to test the AI on/off switches (CI does).
npx playwright install chromium   # once
npm run test:e2e
docker compose -p wikid-dockertest -f docker-compose.yml down -v   # when finished
```

The tests use `http://localhost:8088` by default. Set `WIKID_BASE_URL` to test another instance. Never point them at a production server: they log in as the demo users and create workspaces and pages.

When a test fails, Playwright keeps a screenshot and a trace in `e2e/test-results/`. Open a trace with `npx playwright show-trace <path to trace.zip>` to step through what the browser saw. In CI, these are uploaded as the `playwright-report` artifact.

## How they're written

- `fixtures.ts` gives each test `alice` and `bob`: pages in separate browser sessions, logged in as those demo users. Tests that ask for `workspaceId` get a fresh workspace (Alice owns it, Bob is an editor), deleted afterwards.
- Pages are created through the API to save time; everything the test is about happens through the screen.
- Type at a realistic pace and wait for the app to catch up before acting. Playwright can click and type within a millisecond, faster than the editor registers a click, which produces failures no person would ever see. `placeCursor` waits until the editor has the cursor where the test put it.
- Tests marked `test.fail` describe the correct behaviour for a bug that isn't fixed yet. When the fix lands, Playwright reports "Expected to fail, but passed": change `test.fail` to `test`.

## README screenshots

`readme-screenshots.spec.ts` builds a small demo workspace and retakes the screenshots in `docs/images/` (light and dark). It's skipped in normal runs; to retake them, with the stack running:

```bash
WIKID_SCREENSHOTS=1 npm run test:e2e -- readme-screenshots
```
