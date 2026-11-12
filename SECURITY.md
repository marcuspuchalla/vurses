# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**[Report a vulnerability](https://github.com/marcuspuchalla/vuecli/security/advisories/new)**
(Security tab → "Report a vulnerability"). Don't open a public issue for them.

Include what you ran, what happened, and a minimal reproduction if you can. You'll get an
answer within a week; fixes are released as soon as they're ready and credited in the
release notes unless you'd rather stay anonymous.

## Supported versions

vuecli is pre-1.0: only the latest version gets security fixes.

## What vuecli trusts

vuecli runs code with the privileges of the user who starts it, like `node` does. That
includes **existing web apps run with `vuecli web`**, which leave the browser sandbox.
[docs/SECURITY.md](docs/SECURITY.md) explains the trust model of each feature, what is
protected by default, and how to deploy the server safely.
