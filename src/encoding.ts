/**
 * PNG frames enter FFmpeg as RGB. Let the decoder provide their input matrix;
 * explicitly convert the signal and its metadata to limited-range BT.709.
 * The installed renderer is pinned because the filter hook is version-specific.
 */
export function pngToBt709(args: readonly string[]): string[] {
  const result = [...args], filterIndex = result.indexOf("-vf");
  if (filterIndex < 0) {
    if (result.includes("copy")) return result;
    throw new Error("Expected a video color-conversion filter");
  }
  let found = false;
  result[filterIndex + 1] = result[filterIndex + 1].split(",").map((filter) => {
    if (!filter.startsWith("zscale=")) return filter;
    found = true;
    return "zscale=matrix=709:range=limited:primariesin=709:transferin=709:primaries=709:transfer=709";
  }).join(",");
  if (!found) throw new Error("The pinned renderer color filter changed");
  return result;
}
