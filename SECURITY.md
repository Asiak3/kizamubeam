# Security Policy

Security matters in KizamuBeam because the application processes untrusted files, communicates with network and USB devices, and controls equipment capable of physical harm. This policy covers both **KizamuBeam** and the independently usable **KizamuBeam Virtual Machine** in `vm/`.

## Supported versions

Security fixes are primarily considered for the **latest stable release** and the current development branch. Older releases may not receive patches. The Virtual Machine has a separate release schedule; please identify which application and version are affected.

This is a community-maintained project. There is no guaranteed response time or formal security support SLA.

## Reporting a vulnerability

**Please do not create a public GitHub issue or pull request containing an exploitable security vulnerability, credentials, or a working exploit.**

1. If [GitHub private vulnerability reporting](https://github.com/negurvulkan/kizamubeam/security/advisories/new) is enabled for this repository, use it to submit a confidential report.
2. If it is unavailable, contact [the maintainer](https://github.com/negurvulkan) using a private contact method the maintainer has explicitly published.
3. If no private channel is available, you may open a **brief public issue requesting a confidential security-reporting channel**, without including the vulnerability details, reproduction steps, exploit code, or sensitive attachments.

> Maintainer: enabling GitHub's **Private vulnerability reporting** under repository security settings provides a dependable confidential reporting channel. Do not assume that GitHub mentions or ordinary issues are private.

Please include, where possible:

- A concise description of the issue and its potential impact.
- Affected application (KizamuBeam or Virtual Machine), version, OS, and relevant configuration.
- Safe, minimal steps to reproduce, or a proof of concept shared **privately**.
- Any relevant logs, with credentials, personal data and device secrets removed.
- Whether the issue affects file import, local files, network access, updates, machine control, or another component.
- Any mitigation or proposed fix you have identified.

Please allow time for triage, verification, and a coordinated fix before publicly disclosing a vulnerability. The maintainer may request more information; disclosure timing will be discussed case by case. Please do not expect a guaranteed fix or disclosure deadline.

## Machine-control and physical-safety issues

Unexpected movement, failed homing, malfunctioning limit checks, incorrect laser power, and failures to stop can create **immediate physical hazards**, even when they are not conventional software security vulnerabilities.

- **Stop using the affected function immediately.** Follow your machine manufacturer's emergency-stop and shutdown procedures.
- Do not repeat an unsafe movement or fire the laser merely to collect diagnostic data.
- Never bypass interlocks, limit switches, emergency stops, or protective equipment for testing.
- For a dangerous machine-control bug **without an exploitable security component**, use the [bug report form](https://github.com/negurvulkan/kizamubeam/issues/new/choose), describe the risk clearly, and avoid publishing dangerous step-by-step operating instructions.
- If the issue also exposes a security vulnerability, use the confidential reporting process above.

A passing simulator test is not evidence that a physical machine is safe. Real hardware behavior depends on controller firmware, wiring, configuration, and the machine itself.

## Scope

Relevant examples include:

- Unsafe parsing of imported or downloaded files and extension packages.
- Unauthorized file, network, or device access.
- Execution of untrusted content or command injection.
- Exposure of credentials, tokens, device settings, or personal information.
- Update/download integrity problems.
- Security issues in the built-in MCP integration or the Virtual Machine's network services.

For ordinary crashes, usability problems, requests for features, or non-sensitive regressions, please use the regular issue templates instead.

Thank you for helping keep KizamuBeam and its users safe.
