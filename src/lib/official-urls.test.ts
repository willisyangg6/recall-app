/**
 * Canonical official-URL resolution (C9).
 *
 * The regression fixtures are the REAL corpus: the eight
 * product_visual_failures ledger entries as recorded live on 2026-08-29,
 * and the raw hrefs preserved in the FSIS notices that produced the two
 * malformed ones (030-2021 and PHA-12182021-02 carry protocol-relative
 * hrefs in their stored summary HTML). Byte-stability over well-formed
 * URLs is load-bearing: the label sync matches stored source_url values
 * by equality, so a resolver that "improved" an already-working URL would
 * silently re-fetch the rendered corpus.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FDA_HOSTS, FSIS_HOSTS, resolveOfficialUrl } from './official-urls';

const fsis = (raw: string, baseUrl?: string) =>
  resolveOfficialUrl(raw, { approvedHosts: FSIS_HOSTS, baseUrl });

/** The eight ledger entries, verbatim from the live failure ledger. */
const LEDGER = {
  duplicatedHost: [
    'https://www.fsis.usda.gov//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf',
    'https://www.fsis.usda.gov//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
  ],
  wellFormed: [
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2022-03/Recall%20008-2022%20labels.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2022-07/recall-021-2022-labels.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-12/recall-labels-060-2023_0.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2024-10/Recall-028-2024-Labels.pdf',
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2025-01/recall-004-2025-labels.pdf',
  ],
};

test('an absolute FSIS URL resolves to itself, byte for byte', () => {
  const url =
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/Recall-017-2026-Labels.pdf';
  assert.deepEqual(fsis(url), { url, repaired: false });
});

test('a root-relative href resolves against the agency host', () => {
  assert.deepEqual(fsis('/sites/default/files/food_label_pdf/2026-08/labels.pdf'), {
    url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/labels.pdf',
    repaired: false,
  });
});

test('an ordinary relative href resolves against the page it appeared on', () => {
  assert.deepEqual(
    fsis('files/food_label_pdf/2026-08/labels.pdf', 'https://www.fsis.usda.gov/sites/default/'),
    {
      url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2026-08/labels.pdf',
      repaired: false,
    },
  );
});

test('a protocol-relative official href resolves safely — the defect that built the malformed URLs', () => {
  // The raw href form preserved in notice 030-2021's stored summary HTML.
  assert.deepEqual(
    fsis('//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf'),
    {
      url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf',
      repaired: false,
    },
  );
  // And PHA-12182021-02's.
  assert.deepEqual(
    fsis(
      '//www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
    ),
    {
      url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
      repaired: false,
    },
  );
});

test('the duplicated-host form is repaired to the real document URL', () => {
  assert.deepEqual(fsis(LEDGER.duplicatedHost[0]), {
    url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-08/030-2021-labels.pdf',
    repaired: true,
  });
  assert.deepEqual(fsis(LEDGER.duplicatedHost[1]), {
    url: 'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2021-12/pha-12182021-02-labels.pdf',
    repaired: true,
  });
});

test('all eight recorded ledger URLs normalize correctly', () => {
  // The two malformed entries repair; the six well-formed entries (the
  // size-cap and plain-404 failures) pass through byte-identical.
  for (const url of LEDGER.duplicatedHost) {
    const resolved = fsis(url);
    assert.ok(resolved?.repaired, `${url} must repair`);
    assert.doesNotMatch(resolved.url, /gov\/\//, 'no duplicated host survives');
  }
  for (const url of LEDGER.wellFormed) {
    assert.deepEqual(fsis(url), { url, repaired: false }, `${url} must be byte-stable`);
  }
});

test('query strings and percent-encoded path segments survive untouched', () => {
  const withQuery =
    'https://www.fsis.usda.gov/sites/default/files/food_label_pdf/2023-10/Recall%20047-2023_food%20label.pdf?rev=2&sig=a%2Fb';
  assert.deepEqual(fsis(withQuery), { url: withQuery, repaired: false });
  // Even during a repair, the encoded segments and query survive.
  assert.deepEqual(
    fsis('https://www.fsis.usda.gov//www.fsis.usda.gov/sites/a%20b/labels.pdf?x=1%2B1'),
    { url: 'https://www.fsis.usda.gov/sites/a%20b/labels.pdf?x=1%2B1', repaired: true },
  );
});

test('redundant slashes inside a path collapse — but only on approved hosts', () => {
  assert.deepEqual(fsis('https://www.fsis.usda.gov//sites//default/files/labels.pdf'), {
    url: 'https://www.fsis.usda.gov/sites/default/files/labels.pdf',
    repaired: true,
  });
});

test('external and unapproved domains are never rewritten into official URLs', () => {
  // An external URL that EMBEDS an official host must not become official.
  assert.equal(fsis('https://example.com//www.fsis.usda.gov/sites/labels.pdf'), null);
  assert.equal(fsis('https://evil-fsis.usda.gov.attacker.net/labels.pdf'), null);
  assert.equal(fsis('https://notfsis.usda.gov/labels.pdf'), null);
  // An approved URL embedding a DIFFERENT approved host is left alone, not guessed at.
  const crossHost = 'https://www.fsis.usda.gov//www.fda.gov/files/labels.pdf';
  const resolved = fsis(crossHost);
  assert.equal(resolved?.url.includes('/www.fda.gov/'), true);
});

test('private-network, localhost, credentialed, and non-web URLs are rejected', () => {
  for (const raw of [
    'http://localhost/labels.pdf',
    'http://127.0.0.1/labels.pdf',
    'http://10.0.0.8/sites/labels.pdf',
    'http://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'data:application/pdf;base64,AAAA',
    'javascript:alert(1)',
    'ftp://www.fsis.usda.gov/labels.pdf',
    'https://user:pass@www.fsis.usda.gov/labels.pdf',
    'https://www.fsis.usda.gov:8443/labels.pdf',
  ]) {
    assert.equal(fsis(raw), null, `${raw} must be rejected`);
  }
});

test('http upgrades to https on approved hosts', () => {
  assert.deepEqual(fsis('http://www.fsis.usda.gov/sites/labels.pdf'), {
    url: 'https://www.fsis.usda.gov/sites/labels.pdf',
    repaired: false,
  });
});

test('FDA hosts: exact hosts and *.fda.gov subdomains qualify; lookalikes never do', () => {
  const fda = (raw: string) => resolveOfficialUrl(raw, { approvedHosts: FDA_HOSTS });
  assert.deepEqual(fda('https://www.fda.gov/files/Photo%201.jpg'), {
    url: 'https://www.fda.gov/files/Photo%201.jpg',
    repaired: false,
  });
  assert.equal(fda('/files/photo.jpg')?.url, 'https://www.fda.gov/files/photo.jpg');
  assert.equal(fda('//www.fda.gov/files/photo.jpg')?.url, 'https://www.fda.gov/files/photo.jpg');
  assert.equal(
    fda('https://assets.fda.gov/files/photo.jpg')?.url,
    'https://assets.fda.gov/files/photo.jpg',
  );
  assert.equal(fda('https://notfda.gov/files/photo.jpg'), null);
  assert.equal(fda('https://evilfda.gov/files/photo.jpg'), null);
  assert.equal(fda('https://fda.gov.attacker.net/files/photo.jpg'), null);
});
