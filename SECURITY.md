# Security policy

## Supported versions

Security fixes go to the `main` branch. The film itself is released as media files, which carry no code.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).
Do not open a public issue for security problems.

Include what is affected (a tool, the preview server, the Modal pipeline, a workflow), how to
reproduce it, and its impact. You should get a first response within a week.

## Scope and notes

- `npm run dev` and the render tools start a local Vite server and a headless Chromium. They are
  development tools and are not meant to be exposed to a network.
- The Modal pipeline (`tools/modal/studio.py`) runs with your Modal token and only creates its own
  ephemeral app and cache volume. Keep tokens in `modal setup`'s config, environment variables or
  GitHub Actions secrets, never in the repository.
- Workflows use the repository's `GITHUB_TOKEN` with the least permissions they need
  (`contents: write` only for publishing releases). The *Render on Modal* workflow runs only
  when the repository's owner starts it by hand; CI, which runs on pull requests, uses no
  secrets.
