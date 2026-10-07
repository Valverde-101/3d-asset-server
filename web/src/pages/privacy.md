---
layout: ../layouts/PageLayout.astro
title: Privacy
description: What 3D Asset Server records (search terms without IP addresses, aggregate metrics), what stays in your browser, and which third parties you contact.
schemaType: WebPage
---

# Privacy

3D Asset Server has no accounts, no sign-up, no advertising and no tracking cookies. This page explains exactly what the public service at https://3d.shep.bot records and why.

## What the service records

- **Search events.** For each search the server logs the search text, the asset-type filters, the number of results, which interface was used (website, API or MCP) and a coarse client family derived from the User-Agent (for example "browser", "curl" or "claude-code"). It does **not** log your IP address, API key or cookies with these events. They are used to improve ranking, to find searches that return nothing and to choose topics for the [asset collections](/assets), and are deleted after 14 days. Only search terms used at least three times in a week are considered for a collection topic, and a collection page never shows who searched or how often.
- **Aggregate metrics.** Counters such as searches per minute, downloads per source, page views per page and per-source error rates. They contain no search text and no personal data, and are kept for 10 days. Their totals are public on the [usage statistics](/stats) page.
- **Request logs.** Like any website, the hosting infrastructure keeps standard request logs (which include IP addresses and User-Agents) for security and operations. Logs collected centrally are deleted after 14 days.
- **Rate limiting.** To keep the free service fair, the server counts requests per client IP address in memory for one minute at a time. These counters are never written to disk.

## What stays in your browser

The website stores two optional preferences in your browser's local storage: your light/dark theme choice and, only on self-hosted servers that require one, the API key you entered. Neither is sent anywhere except the API key, which goes back to the same server.

## Third parties you contact

- **Thumbnails** load directly from the asset sites (Poly Haven, ambientCG, BlenderKit and others), so those sites see your IP address when you browse results.
- **Downloads** of single files redirect to the source's CDN. Multi-file zips are assembled by this server from the source files.
- **Links** to source pages take you to those sites, which have their own privacy policies.

## Your choices and contact

Because no account or profile exists, there is nothing to export or delete for an individual visitor beyond the time-limited logs above. Questions or requests: see [Contact](/contact). This policy may change as the service evolves; the current version always lives at https://3d.shep.bot/privacy.
