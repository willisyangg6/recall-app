/**
 * Attributions — the actual current sources and licenses, nothing
 * hypothetical. openFDA's suggested citation is included verbatim; U.S.
 * government works are public domain (17 U.S.C. § 105); the open-source
 * section names only software actually in the shipped dependency graph.
 * Future integrations (e.g. product databases) must be added here only when
 * they actually ship.
 */

import { bullets, link, paragraph, type TrustDocument } from './document-model';

export const ATTRIBUTIONS: TrustDocument = {
  slug: 'attributions',
  title: 'Attributions',
  summary: 'The data sources and open-source software Recall is built on.',
  sections: [
    {
      title: 'Recall data',
      blocks: [
        bullets([
          'Recall announcement data is collected from the U.S. Food and Drug Administration (FDA), including data provided through openFDA. openFDA data is dedicated to the public domain (CC0 1.0). Suggested citation: “Data provided by the U.S. Food and Drug Administration.”',
          'Meat, poultry, and egg product recall and public health alert data is collected from the U.S. Department of Agriculture, Food Safety and Inspection Service (USDA FSIS). As a work of the United States government, it is in the public domain.',
          'Use of this public data does not imply that the FDA, the USDA, or any government agency endorses Recall.',
        ]),
        link('openFDA', 'https://open.fda.gov/'),
        link('USDA FSIS', 'https://www.fsis.usda.gov/recalls'),
      ],
    },
    {
      title: 'Images and documents',
      blocks: [
        paragraph(
          'Product photos shown for FDA notices are the agency’s own published images, loaded ' +
            'directly from the FDA’s website. Label images shown for FSIS notices are rendered by ' +
            'Recall from the official label PDF documents FSIS publishes, and each keeps a link to ' +
            'its original document. Labels and photos may include manufacturers’ trademarks, which ' +
            'remain the property of their owners and appear only as part of the official notice ' +
            'material.',
        ),
      ],
    },
    {
      title: 'Open-source software',
      blocks: [
        paragraph(
          'Recall is built with open-source software used under its respective licenses, ' +
            'including Expo and React Native (MIT), React (MIT), and — in Recall’s server-side ' +
            'processing — the Supabase client library (MIT) and PDF.js (Apache-2.0) for rendering ' +
            'official label documents. Thank you to their maintainers and contributors.',
        ),
      ],
    },
  ],
};
