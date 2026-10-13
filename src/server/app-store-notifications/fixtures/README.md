# Test fixtures for the consent-revocation verifier

`apple-wwdr-g6.cer` is **Apple's real** Worldwide Developer Relations G6
intermediate. It is a public certificate:

- downloaded from https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer
  on 2026-10-13;
- SHA-256 `BD:D4:ED:6E:74:69:1F:0C:2B:FD:01:BE:02:96:19:7A:F1:37:9E:04:18:E2:D3:00:EF:A9:C3:BE:F6:42:CA:30`.

`../apple-jws.test.ts` uses it to prove the chain mathematics on Apple's own
signature: the pinned Apple Root CA - G3 must verify it.

There is **no test certificate chain or key in this folder**. The repository
ignores `*.pem` and `*.key` on purpose. `../test-chain.ts` builds an
Apple-shaped chain at run time, with fresh keys on every run:

- a P-384 root;
- a P-384 intermediate carrying `1.2.840.113635.100.6.2.1`;
- a P-256 leaf carrying `1.2.840.113635.100.6.11.1`;
- a leaf without the marker;
- an expired leaf.
