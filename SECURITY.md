# Security policy

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow under the repository's Security tab. Do not open a public issue for suspected vulnerabilities, credentials, private deployment details, or user data.

Include the affected revision, reproduction steps, impact, and any suggested mitigation. Avoid accessing data that is not yours while validating a report.

## Supported version

Security fixes target the current `main` branch. My AX is self-hosted; deployment owners are responsible for keeping dependencies current, configuring Cloudflare Access, preserving encryption secrets, and applying migrations.

## Deployment boundary

The public repository is a generic engine. Organization-specific hosts, account resources, MCP catalogs, Access settings, and secrets belong in a private deployment wrapper and must not be committed here.
