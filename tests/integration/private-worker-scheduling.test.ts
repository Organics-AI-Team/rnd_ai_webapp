import { describe, expect, it } from "vitest";

import { should_process_material_index_task } from "../../apps/ai/server/worker";

describe("private worker scheduling", () => {
  it("gives a queued AI run a turn after a bounded material-index burst", () => {
    expect(should_process_material_index_task(0, 10)).toBe(true);
    expect(should_process_material_index_task(9, 10)).toBe(true);
    expect(should_process_material_index_task(10, 10)).toBe(false);
  });
});
