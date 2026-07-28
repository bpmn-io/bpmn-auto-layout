import { routePlacedArtifactAssociations } from './AssociationRouting.js';
import { createArtifactLayoutContext } from './Context.js';
import { discoverArtifactOwnership } from './Ownership.js';
import { placeArtifactRecords } from './Placement.js';

export function placeArtifacts(options) {
  const context = createArtifactLayoutContext(options);

  discoverArtifactOwnership(context);
  placeArtifactRecords(context);
  routePlacedArtifactAssociations(context);
}
