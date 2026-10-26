# Contributing to Wikid

Thanks for helping out. Issues and pull requests are welcome. For larger changes, please open an issue first so we can talk through the approach.

## Before you start

- Read the [README](README.md) for setup, and [`docs/`](docs/) for how things fit together.
- Run the checks before opening a pull request:

  ```bash
  npm test
  npm run typecheck
  npm run build
  npm run test:api   # needs a running stack, see api/test/README.md
  npm run test:e2e   # browser tests, needs a running stack, see e2e/README.md
  ```

  CI runs the same checks, plus a Docker image build.

## Licensing of contributions

Wikid is licensed under the [GNU Affero General Public License](LICENSE), version 3 or any later version (AGPL-3.0-or-later). By contributing, you agree that your contribution is licensed under the same terms, and that it's your own work or you otherwise have the right to submit it under them. You keep the copyright in your contribution; there's nothing else to sign.
