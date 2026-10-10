/**
 * The allergen icons (P2B7X.1): every consumer allergen has one glyph, all
 * nine come from one family with recorded provenance, every raster exists
 * at the three scales on one box, and no second icon system reaches the
 * allergen rows.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import {
  ALLERGEN_ICON_FAMILY,
  ALLERGEN_ICON_SOURCES,
  ALLERGEN_ICONS,
  allergenIconName,
  allergenIconRows,
} from './allergen-icons';
import { BUILDING_ICON_SOURCES } from './building-presentation';
import { NOTIFICATIONS_ICON_SOURCES } from './notification-education-presentation';
import { PAYWALL_ICON_SOURCES } from './onboarding-paywall-presentation';
import { READY_ICON_SOURCES } from './ready-presentation';
import { STATES_ICON_SOURCES } from './state-map';

const ROOT = join(__dirname, '..', '..');
const ICONS = join(ROOT, 'assets', 'icons');
const SOURCES = join(ROOT, ALLERGEN_ICON_FAMILY.sourceDirectory);

/** The IHDR width and height of a PNG file. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('every consumer allergen has an icon, and the nine icons are distinct', () => {
  const rows = allergenIconRows();
  assert.equal(rows.length, CONSUMER_ALLERGENS.length);
  assert.equal(rows.length, 9);
  for (const option of CONSUMER_ALLERGENS) {
    assert.ok(allergenIconName(option.token) !== null, `${option.token} has no icon`);
  }
  assert.equal(new Set(Object.values(ALLERGEN_ICONS)).size, 9, 'two allergens share a glyph');
  assert.equal(allergenIconName('gluten'), null, 'a non-selectable token has no icon');
});

test('one family, with license, repository, commit and retrieval date recorded', () => {
  assert.equal(ALLERGEN_ICON_FAMILY.name, 'Lucide');
  assert.equal(ALLERGEN_ICON_FAMILY.license, 'ISC');
  assert.match(ALLERGEN_ICON_FAMILY.commit, /^[0-9a-f]{40}$/);
  assert.match(ALLERGEN_ICON_FAMILY.retrievedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ALLERGEN_ICON_SOURCES.length, 9);
  assert.deepEqual(
    ALLERGEN_ICON_SOURCES.map((s) => s.icon).sort(),
    Object.values(ALLERGEN_ICONS).sort(),
  );
  // The license text and every SVG source are vendored beside each other.
  const license = readFileSync(join(SOURCES, 'LICENSE'), 'utf8');
  assert.match(license, /ISC License/);
  assert.match(license, /Lucide Icons and Contributors/);
  for (const source of ALLERGEN_ICON_SOURCES) {
    const svg = readFileSync(join(SOURCES, `${source.lucideName}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${source.lucideName} is not on the 24 grid`);
    assert.match(svg, /stroke="currentColor"/, `${source.lucideName} is not an outline glyph`);
    assert.match(svg, /stroke-width="2"/, `${source.lucideName} has a foreign stroke weight`);
  }
  // No source outside the nine, the States step's six (P2B7Y,
  // lib/state-map.ts), the Ready step's cart and lock
  // (lib/ready-presentation.ts), the onboarding paywall's file-search and
  // bell (lib/onboarding-paywall-presentation.ts) and the Building step's
  // map-pin and octagon-alert (lib/building-presentation.ts) and notification
  // education's shield-check (lib/notification-education-presentation.ts): a stray glyph
  // would be a second decision.
  // (The problem pictograph's user-round was vendored 2026-09-28 and
  // retired 2026-09-29 with the authored pictograph.)
  const vendored = readdirSync(SOURCES)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  assert.deepEqual(
    vendored,
    [
      ...ALLERGEN_ICON_SOURCES,
      ...STATES_ICON_SOURCES,
      ...READY_ICON_SOURCES,
      ...PAYWALL_ICON_SOURCES,
      ...BUILDING_ICON_SOURCES,
      ...NOTIFICATIONS_ICON_SOURCES,
    ]
      .map((s) => `${s.lucideName}.svg`)
      .sort(),
  );
  for (const source of [
    ...STATES_ICON_SOURCES,
    ...READY_ICON_SOURCES,
    ...PAYWALL_ICON_SOURCES,
    ...BUILDING_ICON_SOURCES,
    ...NOTIFICATIONS_ICON_SOURCES,
  ]) {
    const svg = readFileSync(join(SOURCES, `${source.lucideName}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, `${source.lucideName} is not on the 24 grid`);
    assert.match(svg, /stroke-width="2"/, `${source.lucideName} has a foreign stroke weight`);
  }
});

test('notification education’s shield-check is Lucide’s own glyph at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/shield-check.svg,
  // retrieved from the pinned commit on 2026-10-03.
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'shield-check.svg')),
    '8d4fcdbde5bba4abb1a2f6fe53e37ceb6343a1d5449a9d88f6f97c1971d26c4e',
  );
  const ICONS = join(SOURCES, '..', '..', 'icons');
  assert.deepEqual(
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `shield-check${suffix}.png`))),
    [
      '43fb7f7c4099c109098fbccb75f2d358094970bd56b874aa00597c4e0aebb05a',
      '5ff42e62bd077135c5307c16fbfb0a888a3c0997e9f2f51797759eefb6878f04',
      'd0ff6fff21c5c23f7ee9103cfccf4256969e115e2a2ab11bee2511d5772fd1e3',
    ],
  );
});

test('the Ready cart is Lucide’s own shopping-cart at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/shopping-cart.svg,
  // verified against the pinned commit on 2026-09-26, as every vendored source is.
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'shopping-cart.svg')),
    '7cdc07053044af9e5fd24fff5e089ce97b2a39ea978933a160c4bbfebf8a167c',
  );
  // The three files are true 24, 48 and 72px rasterisations of that source
  // (scripts/render-onboarding-assets.mjs), not one 24px bitmap stretched; the renderer is deterministic, so the verified bytes are pinned.
  const ICONS = join(SOURCES, '..', '..', 'icons');
  assert.deepEqual(
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `shopping-cart${suffix}.png`))),
    [
      'e84f0db572f9d6daee6faf5a2bdbdd8ccb1cc711cc0f476bb433cc4a1ac96928',
      'cc774d083446101bce37ad91eba07d8b4b790a15850221705a4f3676d967eb44',
      '54d204d496204a38e40de2f20b725cba01497785580a755f6947dce0482892d5',
    ],
  );
});

test('the paywall’s file-search and bell are Lucide’s own glyphs at the pinned commit, rasterised natively at every scale', () => {
  // Byte-identical to lucide-icons/lucide@f06ac67e…/icons/file-search-corner.svg
  // and …/icons/bell.svg, retrieved from the pinned commit on 2026-10-01 (the
  // same fetch reproduced the vendored shopping-cart byte for byte).
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(
    sha(join(SOURCES, 'file-search-corner.svg')),
    '4830c66d8d8b4218a9945b6f2673942bb79e4638fa5fb4df051d61e3a9629a85',
  );
  assert.equal(
    sha(join(SOURCES, 'bell.svg')),
    '394889e9631fe3a9a63be9a479a95b451b708e432d895978d21d9130b5ee5dbe',
  );
  // True 24, 48 and 72px rasterisations (scripts/render-onboarding-assets.mjs);
  // the renderer is deterministic, so the verified bytes are pinned.
  const ICONS = join(SOURCES, '..', '..', 'icons');
  const files = (icon: string) =>
    ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `${icon}${suffix}.png`)));
  assert.deepEqual(files('file-search'), [
    '8cad5f66ad4e9d8a9df79f2edb3a940173dbd2410377c7ae52c69a86bb98e819',
    'a0f4147ec6b842f18141bb3de21b2657c0aa780df33430365a4ef0d0877ce362',
    'c9a722eaf04022bf07d31ff2f7cdefead39f9e0862d7670d255b4c5f6562ff92',
  ]);
  assert.deepEqual(files('bell'), [
    'bd0f6879909e3d9886e872594531a976874e46965c38b367ccf509b5d7694753',
    'c2d57f7c95b22a32e616197fbbb70a42fcdbe756d2222c0de065ac22169aa46f',
    '8e470d2eda85c3ba27e416dc604674d224ff1472c444ad7d46a48a0d796c6d66',
  ]);
  assert.deepEqual(
    PAYWALL_ICON_SOURCES.map((s) => s.icon),
    ['file-search', 'bell'],
  );
});

test('the allergen and States glyphs are rasterised natively at every scale, not stretched from 24px (2026-10-09)', () => {
  // Until 2026-10-09 these 15 glyphs' 2x and 3x files were the 24px bitmap
  // enlarged, so every iPhone drew a soft edge. They are now true 24, 48 and
  // 72px rasterisations of the same vendored sources (the 1x bytes did not
  // change), and the script has no stretched path left to fall back to.
  const script = readFileSync(join(ROOT, 'scripts', 'render-onboarding-assets.mjs'), 'utf8');
  assert.doesNotMatch(script, /\bnative\s*[=:]/, 'the renderer has a second, stretched path again');
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const pinned: [string, string[]][] = [
    [
      'allergen-peanut',
      [
        '23647806413ff55989e0c82eed5ee8ca0a9f272b646454ed9967557a55aeb3fe',
        '00eafbd90d5dc251c10328c76db201c98a9d6d0db7f01b6caf3995402e122088',
        '212ebcc35340a3827636418af9cdf49082b0c4b4ca32e40d2f6bc9e4de609d85',
      ],
    ],
    [
      'allergen-tree-nut',
      [
        '4193deaaefd37e52e9f2094cf061b1e72e573826bbe2ff8a2351f26e26483a31',
        '14a113458036d9477a42b91e45fba44611779f776cb2a6dcfe90f921df1ad92a',
        '57a93a973b7d25168ae70d48a09006b355a236736ad1857a7c45fa74476591ae',
      ],
    ],
    [
      'allergen-milk',
      [
        '0a7dd3d6c326662c65e8a0d9c90b10c8424fe8afcc5e0fc514c830f952f1ab84',
        'd0a93738d87560f738bae40d408935d01e3150e3cde7c109358e0438f2812346',
        '303a6013355808a66a0c0f6ad2cfe59a0c5248b5ccc7150d7d208e439dcee986',
      ],
    ],
    [
      'allergen-egg',
      [
        'e95b73becd7da1b303bcfe1209d0bdf7378f9f6aa7afa880803afe19eee4509d',
        '12e1480d20ffb1fb09441c47175161ea2d9e8b3b08c3fb1c6f5030c90b7919c5',
        '903d1dfcd558e604d5cc38a7451d257f78a992d3599b954a3646aa4056688acd',
      ],
    ],
    [
      'allergen-wheat',
      [
        '6b4b56d587228ec95659614c1a69a1dab877faa632d0727000d56a5ffa5ecbfe',
        '219dc146552402aef0d1c261f2d9f34feeb3355b12879e39ba1a82b278d1a3a3',
        'a52c85a6806c5d91a668adb2c8667469845033df0b12a91f363c4e1e0966886a',
      ],
    ],
    [
      'allergen-soy',
      [
        '33574199643b3de5d83a4f2ea851a6afe13d07a5a7166c7d124b06c1cf3b426e',
        '64655e821c87fbf64cee59d5e183e789123627c1e10d3ec8a4eab907b48961d4',
        '70081906d4b9c2c7f888df4e9f16c07710a086644e33aafc4801f964e9553ff2',
      ],
    ],
    [
      'allergen-sesame',
      [
        '6b611c3789ecee2df89cbd54a3596ec9efdfba39f95f310844ac9908aff7e905',
        '76f3c9d6fe7c6ee156665a8556ae1b0199764dbd3c76d503f9fd49fb479966a2',
        '6b107b7f406532b2ae61a29b57f9251c3187af4f5df9b88b391210eef7209e5a',
      ],
    ],
    [
      'allergen-fish',
      [
        '31437da569cd508fc565472a572b2930142dde60c1e1f4940b0106fd3ed7a890',
        '6679370417d498ab995a863ffde5e75351b6b853114baa50ee379805efda4c8b',
        'fa88c8194a5ce8a8a319522d87949a749ebcc27061ee5d2306e4cacc45d55768',
      ],
    ],
    [
      'allergen-shellfish',
      [
        'c5f7cda79c113ac388b88427efbe2433325e779a42e98562cc99c16004301343',
        'b131c2437eb4e2e5a8b202f911d012400c8625d37d17eaa797ae845d0709273f',
        'b54223afe632a31eeb274ade11c7e27cfbb91aad617cb264a5bacfb51508ad19',
      ],
    ],
    [
      'map',
      [
        'ddf37ae458090c6aa77ab2d1f75571080a3cef8a8435a5c687a9080ae5b46e6e',
        '492602cb341ee1d6862379a0de620da501ed1bf3e368b940492519d5dde03458',
        '3ddd193efa8c1fc646c690c8d9fe803faa886b9fa273987603f87ada6bf25a6b',
      ],
    ],
    [
      'list',
      [
        '62053a5de1e2a4d3c9123c86ce916ac4d21dd444cb1caa0d766396d422b24474',
        '417662693ebc43bea2de1b751fbbf8407b2f54bd02de81ea6c6bf3ae06f14413',
        '7af2e975769bb6895a665e03e60cca411d25d7d11d2d2811fa6374b531b8413e',
      ],
    ],
    [
      'x',
      [
        'b790b5b3cee374a1d83557235031140f7ccc3e26572e672ece1a543c87f506d1',
        '1b9794773ea7d0dcc25a0612d28f2bac7261a41184d922875ab65f6344747ffc',
        'e7524217cbabe4e64c1d5f8a854ecc6e164e46c6a05ca11ee1c1449661e13b11',
      ],
    ],
    [
      'check',
      [
        'cc70462ea886a58dbbd43f05f28388522bc92d181ecc823321f0043e59346916',
        '450cf2d00b0a13121264ab2a19f2685d51c2c2b4711f2c29d94f432c750910e5',
        'b944e5fa0718128296c82e2cefcdd4373c9634216bb613c4304dc04092f296cd',
      ],
    ],
    [
      'zoom-in',
      [
        '28ee2cf9f309929bf4602b7faa7dcb432aebfc401355241dcaea55d041717909',
        'f78f78a9367e926a7003c2616bf9817912fe31af72dd1f958f8c9efff8dff488',
        'f6b6e290a9c34bc61ceac0b68a4f9d7086e8b9bd718834e4ee7e372f64c598da',
      ],
    ],
    [
      'zoom-out',
      [
        'cbadb5de32bcb294e2e0e4f919d071c0cdcfd7a34f52debe1320d36f3ab3f87b',
        '057acba85eeb2f2f5badc77bd2c9719540e6ec9df5f970fd7276fab176497130',
        '1d9ad6321ea60e9a40ce5a8504c751c50277b47f1b0ad5093d7053b4c7884c1f',
      ],
    ],
  ];
  assert.deepEqual(
    pinned.map(([icon]) => icon).sort(),
    [...Object.values(ALLERGEN_ICONS), ...STATES_ICON_SOURCES.map((s) => s.icon)].sort(),
  );
  for (const [icon, hashes] of pinned) {
    assert.deepEqual(
      ['', '@2x', '@3x'].map((suffix) => sha(join(ICONS, `${icon}${suffix}.png`))),
      hashes,
      icon,
    );
  }
});

test('every raster exists at 1x, 2x and 3x on the set’s 24pt box — one visual box for all nine', () => {
  for (const icon of Object.values(ALLERGEN_ICONS)) {
    for (const [suffix, side] of [
      ['', 24],
      ['@2x', 48],
      ['@3x', 72],
    ] as const) {
      const file = join(ICONS, `${icon}${suffix}.png`);
      assert.ok(existsSync(file), `missing ${icon}${suffix}.png`);
      assert.deepEqual(pngSize(file), { width: side, height: side }, `${icon}${suffix}.png`);
    }
  }
});

test('Profile’s allergen rows render the family through the one icon primitive — no emoji, no second family, no inline drawing', () => {
  const form = codeOnly(
    readFileSync(join(ROOT, 'src', 'components', 'settings', 'personalization-form.tsx'), 'utf8'),
  );
  const step = codeOnly(
    readFileSync(join(ROOT, 'src', 'components', 'onboarding', 'allergens-step.tsx'), 'utf8'),
  );
  // The onboarding grid draws the Lotly pictograms instead
  // (lib/allergen-assets.ts); this family stays Profile's.
  assert.ok(form.includes('AllergenGlyph'), 'Profile does not render the glyph');
  assert.ok(!step.includes('AllergenGlyph'), 'the onboarding grid still draws the Lucide glyph');
  assert.ok(!/allergen-(peanut|tree-nut|shellfish)['.]/.test(step), 'a Lucide raster in the step');
  assert.ok(step.includes('allergenPictogram(option.token)'));
  for (const [name, source] of [
    ['form', form],
    ['step', step],
  ]) {
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(source), `${name} uses an emoji`);
    for (const foreign of [
      '@expo/vector-icons',
      'MaterialCommunityIcons',
      'Ionicons',
      'FontAwesome',
      'react-native-svg',
      '<Svg',
      '<Path',
    ]) {
      assert.ok(!source.includes(foreign), `${name} mixes in ${foreign}`);
    }
  }
  // One glyph component, one size, one treatment for every row.
  assert.ok(
    form.includes(
      "<Icon name={name} size={20} color={checked ? 'icon/primary' : 'icon/secondary'} />",
    ),
  );
  assert.equal((form.match(/<AllergenGlyph /g) ?? []).length, 1);
});
