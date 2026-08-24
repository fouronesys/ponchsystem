---
name: OpenAPI nullable unions
description: How this workspace's OpenAPI generator handles nullable referenced enums.
---

For a nullable referenced schema, express the field as `oneOf` with the referenced schema and `type: "null"`, rather than combining a `$ref` with `nullable` through `allOf`.

**Why:** Orval can generate an intersection between the referenced enum and `unknown | null`; the resulting runtime validator rejects the null value that the API needs to return.

**How to apply:** Use the `oneOf` form in `lib/api-spec/openapi.yaml`, then regenerate both API client packages before typechecking.