---
name: GitHub branch protection checks
description: GitHub REST branch protection payload compatibility for required status checks
---

Use the modern `required_status_checks.checks` representation or the legacy `contexts` representation, but do not send both in the same update request; GitHub treats them as mutually exclusive schemas.

**Why:** The current GitHub REST endpoint rejects a payload containing both fields with a 422 schema error, even though the successful response exposes both representations.

**How to apply:** When updating branch protection through the GitHub connector, send `strict` plus one required-check representation and verify the saved rule with a follow-up GET.