# Security Policy

## Supported versions

The latest minor of the current major receives fixes. Older majors
receive critical fixes for 90 days after a new major release.

## Reporting a vulnerability

Do **not** open a public issue for suspected vulnerabilities.

Use GitHub's [private vulnerability reporting](https://github.com/danburtenshaw/repo-manifest/security/advisories/new).
If that is unavailable, email the repository owner directly.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- Affected versions.

Expect an initial acknowledgement within 72 hours.

## Build provenance

Every release publishes a Sigstore build-provenance attestation for the
shipped `dist/index.mjs` bundle via GitHub's attestation API. To verify
the bundle you are executing was built from this repo's CI:

```sh
gh attestation verify dist/index.mjs --repo danburtenshaw/repo-manifest
```

Attestations are tied to the release commit, not the floating
`v<major>` tag. If you pin by commit SHA, verification proves that SHA
was built here; if you pin by floating tag, resolve it to a SHA first.

## Handling tokens

`repo-manifest` runs entirely inside GitHub Actions and consumes a token
the user provides via `inputs.token`. The Action does not log, persist,
or transmit the token. Log output is scrubbed of the token where
possible, and users are encouraged to use GitHub's automatic secret
masking. Do not paste token values into issues or pull requests.
