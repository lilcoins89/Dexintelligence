---
name: Graceful market enrichment
description: Optional chain and language-model enrichment should improve signals without making the monitoring dashboard unusable.
---

The monitoring product keeps a deterministic risk and explanation path available when optional external enrichment credentials are missing or upstream calls fail.

**Why:** Market-monitoring surfaces need to load and remain interpretable even when enrichment providers are rate-limited, unavailable, or not configured in a new environment.

**How to apply:** Add optional enrichments behind bounded requests and preserve a clearly labeled fallback signal path rather than blocking the primary market scan.