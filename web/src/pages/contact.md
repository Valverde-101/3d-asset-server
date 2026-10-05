---
layout: ../layouts/PageLayout.astro
title: Contact
description: How to reach the 3D Asset Server maintainers for support, bug reports, security issues, source and licence questions, and partnership requests.
schemaType: ContactPage
---

# Contact

3D Asset Server is maintained in the open. The fastest way to reach the maintainers is GitHub, where every conversation stays public and searchable for the next person with the same question.

## Support and bug reports

Open an issue at [github.com/arielshad/3d-asset-server/issues](https://github.com/arielshad/3d-asset-server/issues). Helpful details: the search query or asset id (for example `polyhaven:ArmChair_01`), the URL or MCP tool you called, what you expected and what happened. For API problems, include the response status and body.

## Security issues

Please do not open a public issue for a vulnerability. Report it privately through GitHub's security advisories at [github.com/arielshad/3d-asset-server/security/advisories/new](https://github.com/arielshad/3d-asset-server/security/advisories/new). You will get an acknowledgement, and fixes are released as soon as they are ready.

## Asset sources and licences

If you run one of the sites the service searches and want your source changed, rate-limited further or removed, or if a licence is shown incorrectly, open an issue with the asset id or source name. Requests from site owners are handled first. Assets themselves are never hosted here, so questions about using a specific asset go to its creator on the source site.

## Integrations and partnerships

Building something on top of the API or the MCP server, or want your asset library added as a source? Open an issue describing the integration. The [provider guide](https://github.com/arielshad/3d-asset-server/blob/main/docs/PROVIDERS_GUIDE.md) explains how new sources are added.

## Machine-readable entry points

- Agent guide: [/AGENTS.md](/AGENTS.md)
- Site index for LLMs: [/llms.txt](/llms.txt)
- API description: [/openapi.json](/openapi.json)
