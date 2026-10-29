/* Add the final campfire for routes that end in Swamp or Volcano.
   PeakMap's published biome sequence remains unchanged. */
(function(root) {
  'use strict';

  const finalByBiome = Object.freeze({
    swamp: 'The Citadel',
    volcano: 'The Kiln'
  });

  function fromBiomes(biomes) {
    if (!Array.isArray(biomes)) return [];
    const stages = biomes.filter(b => typeof b === 'string' && b.trim())
      .map(b => {
        const biome = b.trim();
        return {
          biome,
          label: biome,
          campfireName: biome + ' Campfire',
          isFinalCampfire: false
        };
      });
    if (!stages.length) return stages;

    const last = stages[stages.length - 1].biome.toLowerCase();
    const finale = finalByBiome[last];
    // Never duplicate a final campfire if an upstream feed includes one.
    if (finale && !biomes.some(b => typeof b === 'string' && b.trim().toLowerCase() === finale.toLowerCase())) {
      stages.push({
        biome: stages[stages.length - 1].biome,
        label: finale,
        campfireName: finale,
        isFinalCampfire: true
      });
    }
    return stages;
  }

  root.PeakMapCampfires = Object.freeze({ fromBiomes });
})(globalThis);
