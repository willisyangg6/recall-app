/**
 * Safety Disclaimer — the boundaries of what Recall is. Readable and
 * non-alarmist; the integrity tests pin the non-affiliation and
 * no-medical-advice statements and forbid any diagnosis/treatment claim
 * anywhere in the trust documents.
 */

import { bullets, paragraph, type TrustDocument } from './document-model';

export const SAFETY_DISCLAIMER: TrustDocument = {
  slug: 'safety-disclaimer',
  title: 'Safety Disclaimer',
  summary: 'What Recall is for, and the limits of what it can tell you.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Recall is an informational service. It organizes official government food-safety ' +
            'notices so they are easier to find, read, and act on. It is not a safety certification, ' +
            'and it makes no judgment of its own about any product.',
        ),
      ],
    },
    {
      title: 'Not medical advice',
      blocks: [
        paragraph(
          'Nothing in Recall is medical advice, and Recall does not provide diagnosis or ' +
            'treatment. If you believe you or someone you care for may have been exposed to a ' +
            'recalled product, or you feel unwell, contact a healthcare professional. In an ' +
            'emergency, contact emergency services.',
        ),
      ],
    },
    {
      title: 'The official notice controls',
      blocks: [
        bullets([
          'Every notice in Recall links to its official government source. If anything in Recall conflicts with the official notice, the official notice controls.',
          'Follow the guidance in the official notice and the advice of the issuing agency and your healthcare professionals.',
        ]),
      ],
    },
    {
      title: 'Absence is not safety',
      blocks: [
        paragraph(
          'A product that does not appear in Affects Me — or in Recall at all — is not thereby ' +
            'safe. Affects Me is a shortlist built from your choices and what notices state; ' +
            'agencies do not recall every hazardous product, and notices do not state every detail. ' +
            'No part of Recall guarantees that any product is safe.',
        ),
      ],
    },
    {
      title: 'No affiliation',
      blocks: [
        paragraph(
          'Recall is an independent app. It is not affiliated with, sponsored by, or endorsed by ' +
            'the U.S. Food and Drug Administration, the U.S. Department of Agriculture, or any ' +
            'government agency. Agency names appear only to identify the official sources of the ' +
            'information shown.',
        ),
      ],
    },
  ],
};
