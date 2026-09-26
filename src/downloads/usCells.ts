import usCellData from '../../assets/us/us-cells.json';
import { createUsCoverage, type UsCellData } from '../packs/usCoverage';

/**
 * The bundled map of which cells hold US land (assets/us/us-cells.json, built by tools/build_us_outline.mjs).
 * The app only deals in US territory: the pack fetchers get it in their context, the as-you-pan loader skips
 * cells without US land, and the Downloads picker can't pick them.
 */
export const US_COVERAGE = createUsCoverage(usCellData as unknown as UsCellData);
