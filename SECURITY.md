# Security Policy

## Reporting a Vulnerability

Please use GitHub's **Report a vulnerability** flow under the repository's Security tab. Do not open a public issue for suspected vulnerabilities, credentials, private deployment details, or user data.

Include the affected revision, reproduction steps, impact, and any suggested mitigation. Avoid accessing data that is not yours while validating a report.

## Supported Versions

Security fixes target the current `main` branch. Older deployed revisions and tags are not supported unless their release notes say otherwise. My AX is self-hosted; deployment owners are responsible for updating dependencies, configuring Cloudflare Access, preserving encryption secrets, and applying migrations.

## Deployment Boundary

The public repository is a generic engine. Organization-specific hosts, account resources, MCP catalogs, Access settings, and secrets belong in a private deployment wrapper and must not be committed here.
