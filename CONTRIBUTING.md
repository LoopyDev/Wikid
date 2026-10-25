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
  ```

  CI runs the same checks, plus a Docker image build.

## Contributor License Agreement

Wikid is released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). So that the project can keep offering Wikid under that license and under other licenses in future (including commercial ones), contributions need the agreement below.

When you open a pull request, tick the box in the pull request template to confirm you agree. If you contribute on behalf of your employer, make sure you're allowed to agree to this for them.

### The agreement

By submitting a contribution (code, documentation or other material) to this project, you agree that:

1. **It's yours to give.** The contribution is your original work, or you otherwise have the right to submit it under these terms. If it includes third-party material, you've identified it and its license in the pull request.
2. **You keep your copyright.** You retain ownership of the copyright in your contribution.
3. **You grant LoopyDev a license.** You grant LoopyDev, and anyone LoopyDev distributes the project to, a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, prepare derivative works of, publicly display, publicly perform, sublicense and distribute your contribution and derivative works of it, under any license, including the GNU Affero General Public License and proprietary or commercial licenses.
4. **Patents.** You grant the same parties a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license under any patent claims you can license that are necessarily infringed by your contribution, alone or combined with the project, to make, use, sell, offer for sale, import and otherwise transfer it.
5. **No other obligations.** Your contribution is provided "as is", without warranties, and you're not expected to provide support for it.

This agreement is a plain-language summary of a standard contributor license, not legal advice. If you have questions about it, open an issue before contributing.
