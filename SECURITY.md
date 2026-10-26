# Security

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Report it privately through [GitHub's vulnerability reporting](https://github.com/LoopyDev/Wikid/security/advisories/new) (the Security tab → Report a vulnerability).

Include what you found, how to reproduce it, and what someone could do with it.

Wikid is maintained by one person. I'll acknowledge your report within 14 days, usually sooner. Please give me reasonable time to fix it before publishing anything. Once it's fixed, you'll be credited in the advisory unless you'd rather not be.

There's no bug bounty.

## Testing

Please test against your own copy of Wikid (the Docker setup in the [README](README.md#quick-start-docker) takes a few minutes), not someone else's server.

## Out of scope

- The well-known passwords in the development setup and demo accounts. They're documented, and the production setup doesn't use them.
- Problems that need you to be the system admin already.
- Denial of service by flooding the server with requests.
- Automated scanner output without a demonstrated impact.

## Before you deploy

Wikid is in early development and hasn't had a security review yet. Fixes go into `main`; if you run your own copy, keep it up to date. The README's [Security](README.md#security) section explains how sessions and the defaults work, and [`docs/deployment.md`](docs/deployment.md) covers setting up a server safely.
