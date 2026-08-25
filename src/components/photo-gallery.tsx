import { useState } from 'react';
import { Image, ScrollView, StyleSheet, View, type ImageStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import type { ProductPhoto } from '@/lib/product-photos';

/**
 * Horizontal gallery of official product photography.
 *
 * Deliberately source-agnostic (it takes `ProductPhoto[]`, not an agency
 * shape) so FSIS label imagery can feed the same component later. Images are
 * referenced at their authoritative government URLs, never rehosted, and a
 * failed load removes that image rather than leaving a broken placeholder —
 * a detail page must never degrade because a remote asset is unavailable.
 */
/**
 * How wide a tile may get relative to its height. Government product photos
 * range from 93×619 (a tall bread-bag label) to 480×134 (a wide date-code
 * strip); forcing either into a square leaves most of the tile empty. Sizing
 * each tile to its own published aspect ratio, within these bounds, keeps the
 * image itself filling the space while the row stays a consistent height.
 */
const MIN_ASPECT = 0.45;
const MAX_ASPECT = 2.2;

function tileSize(photo: ProductPhoto, height: number): { width: number; height: number } {
  const aspect = photo.aspectRatio ?? 1;
  const clamped = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect));
  return { width: Math.round(height * clamped), height };
}

export function PhotoGallery({
  photos,
  size = 160,
  accessibilityPrefix = 'Product photo',
}: {
  photos: ProductPhoto[];
  size?: number;
  accessibilityPrefix?: string;
}) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const visible = photos.filter((photo) => !failed.has(photo.url));
  if (visible.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="list">
      {visible.map((photo, index) => {
        // `contain` never distorts or crops; the tile is what adapts.
        const imageStyle: ImageStyle = { ...tileSize(photo, size), borderRadius: Radii.small };
        return (
          <View key={photo.url} accessibilityRole="image">
            <Image
              source={{ uri: photo.url }}
              style={imageStyle}
              resizeMode="contain"
              accessibilityLabel={
                photo.alt ?? `${accessibilityPrefix} ${index + 1} of ${visible.length}`
              }
              onError={() => setFailed((prior) => new Set(prior).add(photo.url))}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * Single small thumbnail for a feed card: a recognition aid, never a
 * placeholder. Renders nothing at all when there is no usable image.
 *
 * Takes a URL rather than a `ProductPhoto` because the feed reads a single
 * persisted field, not the announcement body. That field is written from
 * `primaryPhoto`, so a barcode or date-code crop can never reach a card.
 */
export function PhotoThumbnail({
  uri,
  alt,
  size = 56,
}: {
  uri: string | null;
  alt?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return null;
  return (
    <ThemedView type="backgroundElement" style={[styles.thumbnail, { width: size, height: size }]}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: Radii.small }}
        resizeMode="contain"
        accessibilityLabel={alt ?? 'Recalled product photo'}
        onError={() => setFailed(true)}
      />
    </ThemedView>
  );
}

/** Photo strip with a caption, used inside the package checker. */
export function ComparePhotos({ photos }: { photos: ProductPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <View style={styles.compare}>
      <ThemedText type="small" themeColor="textSecondary">
        COMPARE WITH YOUR PACKAGE
      </ThemedText>
      <PhotoGallery photos={photos} size={130} accessibilityPrefix="Package comparison photo" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  thumbnail: {
    borderRadius: Radii.small,
    overflow: 'hidden',
  },
  compare: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
});
