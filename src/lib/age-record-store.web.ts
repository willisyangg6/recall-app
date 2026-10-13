/** Web variant: the age check never runs on the web, so nothing is stored. */

import type { AgeRecord } from './age-assurance';

export async function loadAgeRecord(): Promise<AgeRecord | null> {
  return null;
}

export async function saveAgeRecord(_record: AgeRecord): Promise<void> {}
