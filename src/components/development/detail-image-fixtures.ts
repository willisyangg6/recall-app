/**
 * DEVELOPMENT-ONLY Recall Detail gallery fixtures (2026-10-07).
 *
 * The bundled baseline holds at most one official photo per recall, so the
 * header's 2-, 3- and 6+-image states and an image that fails to load cannot
 * be shown natively without live data. These fixtures open a real bundled
 * recall (`baselineCaseDetail`) and replace ONLY the header's finished image
 * set with local images, so the gallery renders exactly as production would
 * for that many pages. Nothing here touches image selection, allocation or
 * any recall fact: the projection, every section and every row are the
 * baseline recall's own.
 *
 * The images are the app's own illustrations, not product photographs; the
 * failure fixture's last URL points at a closed local port so it fails at
 * once, without the network.
 *
 * Loaded by the Detail screen through `__DEV__ ? require(…) : null`, which
 * Metro folds away in a production build, so neither this module nor its
 * images can reach a release bundle. Open with the dev client:
 *   exp+recall-app://recall/dev-gallery-2   (two images — dots only)
 *   exp+recall-app://recall/dev-gallery-3   (three — dots and 1 / 3)
 *   exp+recall-app://recall/dev-gallery-7   (seven — five-dot window, 1 / 7)
 *   exp+recall-app://recall/dev-gallery-fail (three published, one fails)
 *   exp+recall-app://recall/dev-mellace      (recorded two-product notice)
 *   exp+recall-app://recall/dev-cards-fruit      (six cards, 1- to 3-line names)
 *   exp+recall-app://recall/dev-cards-shortbread (one card, a 4-line name)
 *   exp+recall-app://recall/dev-cards-rice       (one card, a 5-line name)
 *
 * `dev-mellace` is different: it is the RECORDED official Mellace / Wegmans
 * notice (fda.gov), projected by the real parser from the QA corpus, so the
 * Detail model, the strict row-image allocator and the product cards all run
 * on real evidence: two products, each with the photo whose caption names its
 * own size. Its photos are the official fda.gov URLs, loaded as any recall's
 * are; nothing is overridden.
 *
 * The `dev-cards-*` fixtures exist for the product-name-beside-a-photo layout.
 * No bundled recall has a row photo, and Mellace's names are two lines at
 * most, so these open real bundled recalls with long real product names and
 * put one local image beside EVERY card. Names, fields and every fact are the
 * recall's own; only the card image is a development stand-in.
 */
import { Image } from 'react-native';

import { baselineCaseDetail } from '@/lib/baseline-recalls';
import type { CaseProjection } from '@/domain/recall-types';
import type { CaseDetail } from '@/lib/recall-feed';
import type { DetailImage, DetailImageSet } from '@/lib/recall-presentation';

/** The bundled recall each fixture opens: Hampton Grocers' granola (pairs). */
const BASE_CASE = '6c54040d-cab4-46cc-bf3e-f5e4d1ef4df3';

const LOCAL_IMAGES = [
  require('@/assets/onboarding/sample-gummy-products.png'),
  require('@/assets/design-preview/logo-fixture-tall.png'),
  require('@/assets/design-preview/logo-fixture-wide.png'),
  require('@/assets/images/icon.png'),
  require('@/assets/images/splash-icon.png'),
  require('@/assets/images/favicon.png'),
  require('@/assets/images/android-icon-foreground.png'),
] as const;

/** A closed local port: the request is refused at once, so the tile fails. */
const UNREACHABLE = 'http://127.0.0.1:9/dev-gallery-unreachable.png';

function localImage(index: number): DetailImage {
  return {
    url: Image.resolveAssetSource(LOCAL_IMAGES[index]).uri,
    accessibilityLabel: `Development fixture image ${index + 1}`,
    aspectRatio: null,
  };
}

const SETS: Partial<Record<string, () => DetailImageSet>> = {
  'dev-gallery-2': () => ({ images: [0, 1].map(localImage) }),
  'dev-gallery-3': () => ({ images: [0, 1, 2].map(localImage) }),
  'dev-gallery-7': () => ({ images: [0, 1, 2, 3, 4, 5, 6].map(localImage) }),
  'dev-gallery-fail': () => ({
    images: [
      localImage(0),
      localImage(1),
      { url: UNREACHABLE, accessibilityLabel: 'Development fixture image 3', aspectRatio: null },
    ],
  }),
};

/** Real bundled recalls with long product names, by `dev-cards-*` route. */
const CARD_CASES: Partial<Record<string, string>> = {
  'dev-cards-fruit': 'aef69e0b-4c51-44c3-890c-f28ef0c33075',
  'dev-cards-shortbread': 'c858146a-2306-4f11-a16f-abcc103e8404',
  'dev-cards-rice': '6518e1ac-00ad-4674-823e-043ebb48aef0',
};

export interface DevelopmentDetailFixture {
  detail: CaseDetail;
  /** The header's image set, or null for the model's own. */
  images: DetailImageSet | null;
  /** A stand-in image for every affected-product card, or null for none. */
  cardImage: { url: string; accessibilityText: string } | null;
}

/** The fixture for a development route id, or null for every real recall. */
export function developmentDetailFixture(id: string): DevelopmentDetailFixture | null {
  const cardCase = CARD_CASES[id];
  if (cardCase !== undefined) {
    const base = baselineCaseDetail(cardCase);
    if (!base) return null;
    return {
      detail: { ...base, id },
      images: null,
      cardImage: {
        url: localImage(0).url,
        accessibilityText: 'Development fixture image',
      },
    };
  }
  if (id === 'dev-mellace') {
    const projection = require('./fixtures/mellace-recorded-projection.json') as CaseProjection;
    return {
      detail: {
        id,
        projection,
        timeline: [],
        affectedProducts: projection.affectedProducts ?? [],
        visuals: [],
      },
      images: null,
      cardImage: null,
    };
  }
  const set = SETS[id];
  const base = set ? baselineCaseDetail(BASE_CASE) : null;
  if (!set || !base) return null;
  return { detail: { ...base, id }, images: set(), cardImage: null };
}
