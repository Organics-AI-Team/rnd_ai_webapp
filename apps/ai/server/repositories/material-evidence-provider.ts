/**
 * Raw-material-backed MaterialEvidenceProvider (G4.8d wiring).
 *
 * The concrete evidence source the gateway injects into
 * FormulaArtifactService.validate_draft. It is a pure catalogue read (no model,
 * no provider credentials): a material is evidence-backed when it exists in the
 * platform raw-material catalogue (`raw_materials_console`), and its own
 * catalogue code is recorded as the provenance source. Usage ranges are left
 * null here — the catalogue carries no per-formula usage limits; those come from
 * the knowledge layer (G3.5) and can enrich this provider later without changing
 * its contract. The catalogue is platform-global, so no tenant filter applies.
 *
 * @author AI Management System
 * @date 2026-07-15
 */

import type { Db } from "mongodb";
import type {
  MaterialEvidence,
  MaterialEvidenceIndex,
  TrustedRuntimeContext,
} from "@rnd-ai/ai-orchestration";

import type { MaterialEvidenceProvider } from "../services/ai-control/formula-artifact-service";

/**
 * Create the raw-material-backed evidence provider.
 *
 * @param db - Connected MongoDB database.
 * @returns A MaterialEvidenceProvider over the raw-material catalogue.
 */
export function create_material_evidence_provider(db: Db): MaterialEvidenceProvider {
  const materials = db.collection("raw_materials_console");
  return {
    /**
     * @param material_keys - Material ids and rm codes to resolve.
     * @param _context - Trusted identity (unused: the catalogue is platform-global).
     * @returns Evidence keyed by both rm_code and catalogue _id for each match.
     */
    async load_evidence(
      material_keys: readonly string[],
      _context: TrustedRuntimeContext,
    ): Promise<MaterialEvidenceIndex> {
      if (material_keys.length === 0) return {};
      const keys = [...new Set(material_keys)];
      const documents = await materials.find({ rm_code: { $in: keys } }).toArray();
      const index: Record<string, MaterialEvidence> = {};
      for (const document of documents) {
        const rm_code = String(document.rm_code);
        const evidence: MaterialEvidence = {
          usage_min: null,
          usage_max: null,
          available: true,
          source_ids: [rm_code],
        };
        // Key by both the rm_code and the catalogue id so the validator's
        // `evidence[material_id] ?? evidence[rm_code]` lookup resolves either.
        index[rm_code] = evidence;
        index[String(document._id)] = evidence;
      }
      return index;
    },
  };
}
