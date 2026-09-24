import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Layer, RasterSource } from '@maplibre/maplibre-react-native';

import { LIVE_RASTERS, liveRasterTiles, refreshBucket, type LiveRasterDef, type LiveRasterId } from './liveOverlays';
import { PACK_ANCHORS } from './PackLayers';

/** Bottom -> top. Land managers are opaque pastel fills, so they sit lowest; water linework sits on top. */
const STATIC_ORDER: LiveRasterId[] = ['landManager', 'slopeAngle', 'wetlands', 'nhd'];

interface LiveRasterLayersProps {
  visibility: Record<LiveRasterId, boolean>;
  opacity: Record<LiveRasterId, number>;
}

/**
 * The online-only raster overlays (src/map/liveOverlays.ts). Every source stays mounted and only its
 * layer's visibility flips — MapLibre fetches no tiles for a hidden layer, so a switched-off overlay
 * costs nothing, and toggling never re-creates a native source.
 *
 * Mount this AFTER `<PackAnchors />`: layers are placed by anchor, and an anchor that doesn't exist
 * yet can't be used as a `beforeId`.
 */
export function LiveRasterLayers({ visibility, opacity }: LiveRasterLayersProps) {
  return (
    <>
      {STATIC_ORDER.map((id) => (
        <LiveRaster
          key={id}
          def={LIVE_RASTERS[id]}
          visible={visibility[id]}
          opacity={opacity[id]}
          beforeId={PACK_ANCHORS.raster}
        />
      ))}
      <LiveRaster
        def={LIVE_RASTERS.radar}
        visible={visibility.radar}
        opacity={opacity.radar}
        beforeId={PACK_ANCHORS.hazard}
      />
    </>
  );
}

interface LiveRasterProps {
  def: LiveRasterDef;
  visible: boolean;
  opacity: number;
  beforeId: string;
}

function LiveRaster({ def, visible, opacity, beforeId }: LiveRasterProps) {
  const bucket = useRefreshBucket(def.refreshMs, visible);
  // A new bucket changes the tile URL (cache-buster) and the key, which remounts the source so tiles are re-fetched:
  // a live source's `tiles` are read once when the native source is created.
  const sourceId = def.refreshMs ? `live-${def.id}-${bucket}` : `live-${def.id}`;
  return (
    <RasterSource
      key={sourceId}
      id={sourceId}
      tiles={liveRasterTiles(def, bucket * (def.refreshMs ?? 0))}
      tileSize={def.tileSize}
      minzoom={def.minzoom}
      maxzoom={def.maxzoom}
      attribution={def.attribution}
    >
      <Layer
        id={`${sourceId}-layer`}
        type="raster"
        source={sourceId}
        beforeId={beforeId}
        layout={{ visibility: visible ? 'visible' : 'none' }}
        paint={{ 'raster-opacity': opacity }}
      />
    </RasterSource>
  );
}

/**
 * The current refresh bucket for a time-sensitive layer, re-evaluated every 30 s (and on returning to the
 * foreground) while `active`; 0 for layers that never refresh. Only changes when the bucket rolls over.
 */
function useRefreshBucket(intervalMs: number | undefined, active: boolean): number {
  const compute = () => (intervalMs ? refreshBucket(Date.now(), intervalMs) : 0);
  const [bucket, setBucket] = useState(compute);
  useEffect(() => {
    if (!intervalMs || !active) return;
    const tick = () => setBucket(compute());
    tick(); // catch up if the overlay was off for a while
    const timer = setInterval(tick, 30_000);
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && tick());
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `compute` only closes over intervalMs
  }, [intervalMs, active]);
  return bucket;
}
