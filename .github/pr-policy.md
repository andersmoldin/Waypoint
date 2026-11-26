# PR policy

The review agent reads this file from the default branch on every pull request. It decides what the agent may approve on its own and what goes to the captain. Edit it to fit this repo; it is a protected file.

## The reviewer approves on its own

A change it has read in full that:

- serves the purpose in `VISION.md`,
- keeps every behaviour listed under *Behaviour that must not change silently*,
- has a PR title whose type matches the change (`fix:` for a fix, `feat:` only for a new capability the captain asked for),
- carries tests or evidence in proportion to its risk.

## The reviewer escalates to the captain

Label `needs-captain`, request the captain's review, and say why in one comment. Escalate when the change:

1. touches a path listed in `.github/CODEOWNERS`; CODEOWNERS enforces this too,
2. changes a default or other existing behaviour users rely on, even when it looks like an improvement,
3. contains or exposes a secret, token, key, password, personal data or other sensitive information the captain has not explicitly approved,
4. sits outside `VISION.md`, or the vision does not settle it,
5. is marked as a breaking change (`!` or `BREAKING CHANGE`),
6. is something the reviewer cannot judge with confidence after reading it, or the author and reviewer have gone two rounds without converging.

PRs from forks and from Dependabot never reach the reviewer: the workflow labels them `needs-captain`.

The captain answers an escalation by approving, by requesting changes, or by a comment starting with `@review` that states the decision; that comment re-runs the review.

A risk classification never lowers these bars: a "low-risk" label on a change that hits any item above is still escalated.

## Repo-specific rules

- **The title never sets a version.** Waypoint's version is CalVer `YYYY.M.N`, taken only from a `v*` tag that the owner creates (`VISION.md`). A title's type (`feat`, `fix`, `!`) releases nothing and changes no version number. Escalate a change that makes any workflow or script create, move or derive a tag or a version.
- **Behaviour that must not change silently.** Escalate a change to anything listed under that heading in `VISION.md`, even when it looks like an improvement.
- **Limits and risks are documented.** A change that adds a limit or accepts a risk documents it in the same PR, in `SECURITY.md`, `SECURITY_AUDIT.md`, `PRIVACY.md`, `ACCESSIBILITY.md` or `docs/kanda-granser.md`. Request changes when it does not. Escalate a new accepted risk: it needs the owner's acceptance.
