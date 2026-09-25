import JSZip from 'jszip';

/**
 * A KMZ is a zip holding one KML (conventionally `doc.kml`) plus the icons and images it references.
 * Returns the KML text, or null when the bytes aren't a zip at all (some apps name plain KML `.kmz`).
 * Throws when it is a zip with no KML inside.
 */
export async function extractKmlFromKmz(bytes: Uint8Array): Promise<string | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }

  const kmlEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.kml$/i.test(entry.name))
    // The main document is the root-level one; a KMZ can also carry KML in subfolders.
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  const main = zip.file('doc.kml') ?? kmlEntries[0];
  if (!main) throw new Error('This KMZ file has no KML inside it.');
  return main.async('string');
}
