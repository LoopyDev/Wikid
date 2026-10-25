# API end-to-end tests

These tests call the Wikid API over HTTP, the way the web app does, against a running stack. They check behaviour rather than code structure, so they stay valid when the code behind the API is rearranged.

## Running them

Start a stack with the demo users (the default), then run the tests from the repo root:

```bash
docker compose -p wikid-dockertest -f docker-compose.yml up -d --build --wait
npm run test:api
docker compose -p wikid-dockertest -f docker-compose.yml down -v   # when finished
```

`-f docker-compose.yml` matters if your `.env` sets `COMPOSE_FILE` for development.

The tests use `http://localhost:8088/api` by default. To test another API, set `WIKID_API_URL`, for example `WIKID_API_URL=http://localhost:3000 npm run test:api` for a dev server.

Never point them at a production server: they log in as the demo users and create workspaces, pages and users.

## How they're written

- They log in as the seeded demo users (`admin`, `alice`, `bob`, password `wikid`). Permission tests use Alice and Bob, because the system admin skips page access checks outside production.
- Each test creates its own workspaces and pages with unique names, so the suite can run repeatedly against the same stack.
- `helpers.ts` has the logged-in `Session` and small helpers for creating workspaces, members and pages.

## Known bugs

Tests marked `it.fails` describe the correct behaviour for a bug that isn't fixed yet. They pass while the bug exists. When a fix lands, the test starts failing: change `it.fails` to `it`.
