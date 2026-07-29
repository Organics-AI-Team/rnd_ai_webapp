/**
 * G3.5 — tenant-bound upload authorization.
 *
 * The public input contains only a source id. Tenant, actor, object prefix,
 * byte ceiling, MIME allowlist, and expiry are all server-authored and signed.
 */

import { describe, expect, it } from "vitest";

import {
  create_hmac_upload_authorization_signer,
  issue_upload_authorization,
  parse_upload_authorization_request,
  type UploadAuthorizationDeps,
} from "../../apps/ai/server/services/knowledge/upload-authorization";

const TENANT_A = "507f1f77bcf86cd7994390a1";
const TENANT_B = "507f1f77bcf86cd7994390b1";
const ACTOR_A = "507f191e810c19729de860ea";
const SOURCE_A = "507f1f77bcf86cd7994390c1";
const NOW = new Date("2026-07-15T00:00:00.000Z");

/** Build upload service dependencies with a real signer and in-memory ports. */
function make_deps(
  source_overrides: Record<string, unknown> = {},
): UploadAuthorizationDeps {
  return {
    source_port: {
      async get_tenant_source() {
        return {
          source_id: SOURCE_A,
          tenant_id: TENANT_A,
          status: "quarantined",
          ...source_overrides,
        };
      },
      async bind_upload() {},
    },
    policy_port: {
      async get_upload_policy() {
        return {
          maximum_bytes: 2_000_000,
          allowed_detected_mime_types: ["application/pdf", "text/plain"],
        };
      },
    },
    signer: create_hmac_upload_authorization_signer({
      secret: "test-only-secret-with-sufficient-entropy",
      now: () => NOW,
    }),
    authorization_ttl_ms: 5 * 60 * 1000,
    now: () => NOW,
  };
}

describe("upload authorization", () => {
  it("accepts only a source id in the public request", () => {
    expect(parse_upload_authorization_request({ source_id: SOURCE_A })).toEqual({
      source_id: SOURCE_A,
    });
    expect(() =>
      parse_upload_authorization_request({
        source_id: SOURCE_A,
        tenant_id: TENANT_B,
      }),
    ).toThrowError();
    expect(() =>
      parse_upload_authorization_request({
        source_id: SOURCE_A,
        actor_profile_id: "forged",
      }),
    ).toThrowError();
  });

  it("binds signed claims to the verified tenant and actor with a tenant object prefix", async () => {
    const deps = make_deps();
    const authorization = await issue_upload_authorization(
      { tenant_id: TENANT_A, actor_profile_id: ACTOR_A },
      { source_id: SOURCE_A },
      deps,
    );

    expect(authorization).toMatchObject({
      tenant_id: TENANT_A,
      actor_profile_id: ACTOR_A,
      source_id: SOURCE_A,
      object_key: `tenants/${TENANT_A}/knowledge/${SOURCE_A}/source`,
      maximum_bytes: 2_000_000,
      allowed_detected_mime_types: ["application/pdf", "text/plain"],
      expires_at: "2026-07-15T00:05:00.000Z",
    });
    await expect(deps.signer.verify(authorization.token)).resolves.toMatchObject({
      tenant_id: TENANT_A,
      actor_profile_id: ACTOR_A,
      source_id: SOURCE_A,
      object_key: authorization.object_key,
    });
  });

  it("rejects another tenant's source and a source outside quarantine", async () => {
    await expect(
      issue_upload_authorization(
        { tenant_id: TENANT_A, actor_profile_id: ACTOR_A },
        { source_id: SOURCE_A },
        make_deps({ tenant_id: TENANT_B }),
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_NOT_FOUND" });
    await expect(
      issue_upload_authorization(
        { tenant_id: TENANT_A, actor_profile_id: ACTOR_A },
        { source_id: SOURCE_A },
        make_deps({ status: "ready" }),
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_NOT_QUARANTINED" });
  });

  it("rejects a tampered or expired authorization", async () => {
    const deps = make_deps();
    const authorization = await issue_upload_authorization(
      { tenant_id: TENANT_A, actor_profile_id: ACTOR_A },
      { source_id: SOURCE_A },
      deps,
    );

    await expect(
      deps.signer.verify(`${authorization.token}tampered`),
    ).rejects.toMatchObject({ code: "UPLOAD_AUTHORIZATION_INVALID" });

    const later_signer = create_hmac_upload_authorization_signer({
      secret: "test-only-secret-with-sufficient-entropy",
      now: () => new Date("2026-07-15T00:06:00.000Z"),
    });
    await expect(later_signer.verify(authorization.token)).rejects.toMatchObject({
      code: "UPLOAD_AUTHORIZATION_EXPIRED",
    });
  });
});
