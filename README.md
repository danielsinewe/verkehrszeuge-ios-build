# Encrypted iPhone build harness

This repository contains the build automation for Verkehrszeuge. The application
repository remains private. A maintainer dispatches an authenticated encrypted
request for one exact published source commit and one unused build number.

The macOS runner runs the current iPhone tests, builds the bundled interface and
compiles an unsigned iOS device archive. Source code, diagnostics and output
archives are never published in plaintext. Input uses a one-request AES-256-GCM
key in the repository's Actions secret; output uses an independent ephemeral
RSA-OAEP-256/AES-256-GCM recipient held by the private cloud publishing workspace.
Apple API and distribution private keys are never provided to this repository.

Only owner-dispatched workflows on main run. Dependencies/actions are pinned,
plaintext runner data is discarded, and public release assets contain ciphertext
only. The private cloud recipient verifies and retains the archive, signs with
the registered distribution identity, and uploads through App Store Connect CLI.
The encrypted transfer primitive has tamper, context and recipient regression
tests. Official public Apple PKI roots in `trust/` support offline signature
verification; they do not change network TLS trust.
Encrypted iOS build harness for Verkehrszeuge; application source and build outputs stay encrypted.

Portfolio quality jobs select commands from the committed catalog by exact
workflow SHA256. Reviewed versions may append required checks while retaining
every base command and its warning policy. Unrecognized versions and narrower
source requests fail before source commands run. The workflow runs these guard
tests before decrypting any private input. Existing base-version requests retain
their original scope; new browser checks require their own authenticated result.
