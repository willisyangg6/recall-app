/**
 * The native side of the launch age check: Apple's Declared Age Range API
 * through expo-age-range, normalized into the ports lib/age-assurance.ts
 * decides on. Every port answers; none throws.
 *
 * The native module is looked up OPTIONALLY rather than through the
 * package's own entry, which requires it at import time. A binary without
 * it — a development client built before expo-age-range was added — would
 * otherwise crash at launch. Here it fails CLOSED instead: every answer is
 * "failed" or "unknown", which on iOS 26+ lands on the Try again screen and
 * never on the app. A release build always contains the module.
 *
 * expo-age-range itself answers `lowerBound: 18` below iOS 26. That answer
 * is never asked for: lib/age-assurance.ts checks the OS version first.
 */

import { requireOptionalNativeModule } from 'expo';
import type { AgeRangeRequest, AgeRangeResponse } from 'expo-age-range';
import { Platform } from 'react-native';

import { answerFromNative, type AgeCheckPorts } from './age-assurance';
import { loadAgeRecord, saveAgeRecord } from './age-record-store';

interface ExpoAgeRangeModule {
  requestAgeRangeAsync(options: AgeRangeRequest): Promise<AgeRangeResponse>;
  isEligibleForAgeFeaturesAsync(): Promise<boolean | null>;
  getRequiredRegulatoryFeaturesAsync(): Promise<string[] | null>;
}

export function createAgeCheckPorts(): AgeCheckPorts {
  const native =
    Platform.OS === 'ios' ? requireOptionalNativeModule<ExpoAgeRangeModule>('ExpoAgeRange') : null;
  return {
    os: Platform.OS,
    osVersion: Platform.Version,
    isEligible: async () => (native ? native.isEligibleForAgeFeaturesAsync() : null),
    requiredRegulatoryFeatures: async () =>
      native ? native.getRequiredRegulatoryFeaturesAsync() : null,
    requestAgeRange: async ([threshold1, threshold2, threshold3]) => {
      if (native === null) return { kind: 'failed', code: 'ERR_MODULE_MISSING' };
      return answerFromNative(() =>
        native.requestAgeRangeAsync({ threshold1, threshold2, threshold3 }),
      );
    },
    loadRecord: loadAgeRecord,
    saveRecord: saveAgeRecord,
    now: () => new Date(),
  };
}
