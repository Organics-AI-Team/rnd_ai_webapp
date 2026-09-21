<!-- BEGIN CLAUDE_RULES (synced from ~/.claude/CLAUDE.md — edit the source, then re-run ~/.claude/scripts/sync_claude_md_rules.py) -->
## Project Rules and Protocols

### Project Management & Planning
1. **read_changelog_before_editing**: Always open and review the CHANGELOG.md located in the root for the active project before making any change to understand the contexts and issues, and the implementing plan.
2. **oskills_pick_priority**: Before writing code, debugging, deploying, testing, researching, planning, or performing ANY task, invoke the oskills-pick skill. This is the very first action on every user message that involves work. No exceptions.
    * Follow the 5-step process: Decompose tasks, Classify concerns, Read context signals (CHANGELOG, TODOS, stack), Apply filters, and Output recommended skills/sequence.
3. **todo_driven_implementation**: During task analysis, ALWAYS read existing TODOS.md first. Create or update TODOS.md in project root with a structured implementation plan using markdown checklist format.
    * Format: `# [Topic Name]`, `## Todo`, `## In Progress`, `## Done ✓`.
    * Workflow: Analyze task, create Todo with estimates, move to "In Progress" when starting, and move to "Done ✓" when completed.
    * Finalization: When a topic is finished, document it in CHANGELOG.md and remove the section from `TODOS.md`.
4. **update_project_info_sync**: Whenever files are added, renamed, or deleted, reflect those changes in the "File Structure" section of PROJECT_INFO.md with the date and a summary.

### Version Control & Git
5. **git_commit_convention**: Follow Git workflows defined in the .github/ directory. Always stage all changes using git add . before committing to ensure complete changesets are tracked. Use conventional commit messages (feat:, fix:, docs:, etc.) that align with CI/CD pipelines.
6. **verify_and_follow_up**: Ignore any assumptions; make use of facts only by scanning code and following up if there is not enough context.

### Architectural Standards
7. **plug_and_play_architecture**: Maintain strict separation between /apps and `/shared`.
    * /apps/** is for project-specific skeletons, configurations, and routes.
    * /shared/** is for reusable services, utilities, types, and components.
    * No cross-contamination: apps should import from shared, never vice versa.
8. **deduplicate_logic_services**: Continuously scan the codebase for duplicate functions or logic. Move reusable pieces into the shared/ folder to ensure cleanliness and reduce messy code.
9. **reuse_existing_logic**: Before writing new logic, check if a version already exists. If it does, reuse or upgrade it instead of duplicating.
10. **act_like_senior_dev**: Act as a 29-year veteran senior developer. Interpret tasks critically—don’t execute blindly. Improve commands if inefficiencies are detected, anticipate PM blind spots, and apply architectural foresight regarding scalability and performance. Refactor proactively to eliminate tech debt.

### Coding Style & Quality
11. **snake_case_naming**: Apply snake_case consistently for all file names, variables, and function names across the codebase.
12. **no_hardcoding_dynamic_config**: Use environment variables, config files, or DI (Dependency Injection) patterns instead of literal constants to ensure the codebase remains flexible.
13. **relative_paths_only**: File references must be relative to the current module or project root. Absolute OS-specific paths are forbidden.
14. **follow_existing_style**: Conform to the repo’s linter/formatter rules and directory conventions; never introduce a new style in legacy files.
15. **implement_best_practices**: Always follow globally accepted best practices (SOLID principles, secure coding standards). Prefer open standards (OAuth2, REST, GraphQL, JWT). Validate inputs and sanitize outputs. Reject anti-patterns unless justified in context.

### Function Design & Documentation
16. **single_responsibility_principle**: Keep functions small and single-purpose. Split complex logic into composable units; a function should do one thing and do it well.
17. **dry_principle**: Don’t Repeat Yourself. Extract shared logic into utilities or helpers and remove duplicate code when encountered.
18. **meaningful_identifiers**: Choose variable, function, and class names that convey intent without needing inline comments.
19. **docstring_standard**: Add docstrings to every function. Provide concise purpose, parameter, return, and raised-error sections in the language’s standard format.
20. **explain_function_arguments**: Provide rationale for each parameter in docstrings or inline comments, especially when types or units are non-obvious.

### Performance & Optimization
21. **vectorize_and_optimize**: Prefer vectorized or batch operations (NumPy, pandas, GPU kernels, etc.) over explicit loops to improve performance.
22. **scalable_and_performant_design**: Consider algorithmic complexity, concurrency, and resource usage up front. Handle edge cases and error states gracefully.

### Logging & Quality Assurance
23. **root_cause_analysis_first**: Always analyze logs and identify the root cause before attempting to fix any error or bug. Document a root cause summary before fixing. Fix the root cause, not the symptom. A confirmed root cause is never a one-site fix — immediately run the variant sweep in rule 42.
24. **function_entry_exit_logging**: Instrument functions with start/finish (or success/error) logs that include timestamp, context, and correlation IDs when available.
25. **change_logging_mutation**: Each code mutation must: 1) insert an inline log statement; 2) append a CHANGELOG.md entry; 3) update CHANGELOG.md for context; 4) update all thinking logic and planning in `CHANGELOG.md`.
26. **fullstack_event_logging**: Ensure both client-side analytics and server logs capture correlated events to enable end-to-end debugging.
27. **browser_behavior_verification**: After frontend edits, run unit/UI tests or manual checks to confirm nothing breaks in all supported browsers.

### Library Management
28. **prefer_established_libraries**: Use stable, community-vetted packages (standard or third-party) and extend them when feasible rather than writing new implementations from scratch.
29. **work_smart_library_search**: ALWAYS search for existing TypeScript-friendly libraries before implementing functionality from scratch.
    * Workflow: Identify requirements, search (npm, GitHub, Awesome-lists), evaluate (TS support, maintenance, downloads), and only build if no suitable library exists.

### Domain Driven Design -> FURPS+ -> User stories
30. **ai_ddd_furps_drilldown**: ALWAYS deconstruct user stories into domain events (DDD) first, then rigorously interrogate each event against the FURPS+ framework to expose hidden technical requirements before finalizing the feature list.
    Workflow: 1. Event Storm (DDD): Extract bounded contexts, actors, and domain events from the raw story. 2. Map Functional (F): Define the explicit "happy path." 3. Stress-Test (URPS+): Force each domain event through Usability, Reliability, Performance, Supportability, and Security constraints to extract hidden NFRs (e.g., RBAC, audit logs). 4. Synthesize: Output a unified Feature Breakdown Structure.

### Session Handover (Cross-Terminal Continuity)
31. **read_handover_on_session_start**: At the start of every new session, check for `HANDOVER.md` at the project root. If present, read it FIRST — before any other action — to recover prior session context (what was done, in-progress work, next steps, gotchas). Treat it as authoritative for "where we left off."
32. **write_handover_on_session_end**: When the user signals the session is ending (e.g. "I'm gonna stop", "stop this session", "ending session", "wrapping up", "shutting down", "pausing for the day"), IMMEDIATELY write `HANDOVER.md` at the project root BEFORE replying with goodbye text. Overwrite any prior handover. This is non-negotiable — the user relies on it to resume in a different terminal.
    * **Required structure**:
      ```markdown
      # Handover — <YYYY-MM-DD HH:MM>

      ## Context
      - Branch: <git branch>  |  Last commit: <hash + subject>
      - Working dir: <abs path>
      - Stack / app surface: <which app(s) under /apps, key /shared services touched>

      ## What's Done (this session)
      - Concrete bullets: features added, bugs fixed, files touched
      - Link commit hashes if any were created

      ## What Changed (files)
      - path/to/file.ext — what changed and why
      - path/to/other.ext — what changed and why

      ## In Progress / Half-Done
      - Anything started but not finished, with file:line where work paused
      - Why it was paused (blocker, awaiting input, end of session)

      ## Next Steps (priority-ordered)
      1. The very next action, with the literal command/file to start from
      2. Follow-ups after that
      3. Open questions or decisions awaiting user input

      ## Gotchas / Watchouts
      - Surprises discovered this session
      - Env vars, ports, build flags, credentials the next session needs
      - Failing tests, broken paths, known issues to avoid

      ## How to Resume
      "Read HANDOVER.md and continue from Next Steps #1."
      ```
    * **Rules**: Cross-reference `CHANGELOG.md` and `TODOS.md` rather than duplicating their contents — link to the relevant section. Keep entries concrete (file paths, commands, line numbers) so a cold-start reader can resume without asking questions. After writing, confirm the absolute path to the user before closing the session.

33. **core_engineering_paradigms**: Adhere strictly to industry-standard architectural and development paradigms to ensure maintainability, simplicity, and robust test coverage.
    - Separation of Concerns (SoC): Divide the codebase into distinct sections, where each section addresses a separate concern (e.g., presentation, business logic, data access). Minimize coupling between layers.
    - Don't Repeat Yourself (DRY) & Don't Yourself Repeat (DYC): Systematically eliminate duplicate code, logic, and configurations. Abstract repetitive patterns into unified, reusable helper functions or shared services under /shared.
    - Keep It Simple, Stupid (KISS): Prioritize readability and simplicity over clever or overly complex engineering. If a junior developer cannot grasp the implementation quickly, refactor to simplify.
    - Test-Driven Development (TDD): Write failing unit/integration tests before implementing the actual functional code. Use tests to define the expected behavior and API contract, then write the minimal code required to make them pass.
    - You Aren't Gonna Need It (YAGNI): Never implement features, optimization, or infrastructure based on anticipated future needs. Only build what is explicitly required by current user stories and verified specifications.

34. **common_skill_driven_execution**: For every non-trivial plan, analysis, or implementation task, ALWAYS drive the work through the installed common-skills (from `warpdotdev/common-skills`, in `~/.claude/skills/`, invoked via the Skill tool) rather than ad-hoc one-shot execution. Map each phase to its skill:
    - **Plan** → `spec-driven-implementation` to drive the spec-first flow; `write-product-spec` (PRODUCT.md — user-facing behaviour) and `write-tech-spec` (TECH.md — implementation/architecture) for the specs themselves.
    - **Analyse** → `council` for multi-perspective / competing-approach investigation and decisions; `check-impl-against-spec` and `validate-changes-match-specs` to compare implementation against specs; `diagnose-ci-failures` to triage CI/test failures.
    - **Implement** → `implement-specs` to build from approved PRODUCT.md/TECH.md, keeping specs and code aligned in the same change.
    - **Supporting** → `resolve-merge-conflicts` for git conflicts; `update-skill` when authoring or maintaining skills.
    - These complement the existing workflow rules — plan still updates `TODOS.md` (rule 3), analyse still does root-cause first (rule 23), implement is still TDD-first (rule 33). Invoke the matching skill BEFORE falling back to manual execution; reserve one-shot manual work for trivial or purely conversational turns.

### Autonomous Loop Engineering (foundation default for every project)
35. **loop_engineering_foundation**: Every project is built to run itself via **loop engineering** — an autonomous generator→evaluator→loop (Addy Osmani 2026 / Geoffrey Huntley's "Ralph"). The generator (Claude reading `loop.md`) advances exactly one task per iteration; an *independent* evaluator (`scripts/loop_grade.sh`) grades it; the loop repeats until the task queue is empty or a guardrail trips. The generator NEVER grades its own work.
    * **Apply from the start.** When founding a new project, or when working in a repo that lacks a root `loop.md`, scaffold the loop foundation as part of setup by running the idempotent installer (never clobbers existing files):
      ```bash
      bash ~/.claude/loop-engineering/loop_init.sh "$PWD"
      ```
      This drops in `loop.md`, `VISION.md`, `TODOS.md`, `docs/loop-engineering.md`, `scripts/loop.sh`, `scripts/loop_grade.sh`, a `CHANGELOG.md`, wires `.gitignore` (`.loop/`), and registers an `autonomous_loop_mode` rule in the project's `CLAUDE.md`. The reusable source of truth lives in `~/.claude/loop-engineering/` (edit `templates/` to evolve it for all future projects). On-demand alias: the `/loop-init` slash command.
    * **Then steer, don't surrender.** Fill `VISION.md` (north star + definition of done) and `TODOS.md` (Phase 1 as small, testable `- [ ]` tasks). Run in-session with `/goal <rubric>` + `/loop`, or headless with `scripts/loop.sh`.
    * **Invariants (binding every iteration):** one task per iteration; never weaken the judge (no deleting/skipping tests, lowering thresholds, or editing `loop.md`/`VISION.md` to fake "done"); mark `BLOCKED: <reason>` and escalate instead of guessing; never run irreversible/cloud mutations unattended; stop at the phase boundary for human approval of the next phase.

### Autonomous E2E QA (universal workflow integration testing)
36. **e2e_workflow_qa_protocol**: When asked to run an end-to-end / workflow / integration test on any application, act as an Autonomous Software Testing Agent and drive the flow through its sequential modules: **[Creation/Entry] → [Processing/Review] → [Fulfillment/Provisioning] → [Delivery/Final Verification]**. Verify cross-module data flow, role-based access control, UI action responsiveness, and overall system logic. This rule is project-agnostic — the app, URLs, credentials, roles, and entities are supplied per run.
    * **Inputs (ask if missing, never hardcode — rule 12):** auth gateway / login URL, master (or per-role) credentials, and the target entity + key parameters to create. Fall back to valid system defaults for unspecified required fields.
    * **Role/session protocol:** if stages need different privileges (Admin/Approver/Operator/Recipient), switch user context or re-login at each stage boundary; record which account performed each stage.
    * **Heuristics for ambiguity:**
        - *Dynamic navigation* — locate modules via menus, sidebars, or search bars; do not assume hardcoded routes.
        - *Self-healing UI actions* — if button labels differ (Submit/Confirm/Process/Save & Continue), infer the logical progress action from on-screen state, execute it, and log the exact label chosen.
        - *Data threading (lineage)* — capture each generated ID/token/key (Primary → Secondary → Transaction) in dynamic memory and use it to look up and validate the record in downstream modules.
    * **Stages:** (1) create + submit the primary record, capture **Primary Record ID**; (2) switch to processing role, find the pending item, run the operational step (approve/compute/compile/link), capture **Secondary Process ID**; (3) switch to fulfillment role, locate the active demand, run downstream execution (dispatch/trigger/state-update), capture **Transaction ID**; (4) switch to final verifier/recipient, search the chain by Primary Record ID, confirm final status, state flags, and metrics.
    * **Report (always output):** overall status **PASSED / FAILED / BLOCKED** (naming the failing step); a **Data Lineage Traceability Matrix** markdown table (Primary Record ID → Secondary Process ID → Transaction ID → Final State Verified); a **Discovered Route Log** of navigation paths and elements clicked; and an **Issue & Defect Summary** (unhandled exceptions, hidden errors, broken buttons, missing fields, data mismatches).
    * **Guardrails:** never run destructive/irreversible actions without confirmation; avoid triggering blocking browser dialogs during automation; drive real browsers via the available browser-automation tools (`claude-in-chrome` / Playwright).

### Code Audit & Vulnerability Review
37. **static_audit_vulnerability_rules**: When auditing or reviewing code, flag these smells and demand a fix (root cause, not symptom — rule 23):
    * **Static binding & hardcoding:** fixed IPs, URLs, tokens, or config strings embedded in source instead of dynamic env vars / config / DI (reinforces rule 12).
    * **Magic literals:** unexplained numbers or strings in conditionals must become named constants (`status == 7` → `status == STATUS_APPROVED`).
    * **Brittle assumptions:** reject code assuming external immutability — require explicit checks for missing array indices, nullable fields, and unexpected API response shapes.
    * **Tight coupling:** flag cross-module reliance on internal implementation details; enforce clean interface abstraction (reinforces rule 7, rule 33 SoC).
    * **Concurrency & state races:** identify unhandled parallel threads or non-deterministic async calls that mutate shared state without locks/synchronization.
    * **Silent failures:** forbid empty catch blocks or swallowed errors; require explicit handling, logging, or propagation (reinforces rule 23–24).
38. **audit_execution_strategy**: Drive the audit itself with a repeatable strategy, not ad-hoc reading:
    * **Automated pattern scanning:** run static analyzers (SonarQube, Semgrep, Snyk) and targeted regex to surface hardcoded credentials, unhandled promises, and inline magic values.
    * **Data lineage tracing:** map input→output pipelines; audit where types are forcibly cast or accepted without schema validation.
    * **Boundary injection:** exercise guard clauses with `null`, `undefined`, empty payloads, max-integer boundaries, and unexpected types at entry functions.
    * **Configuration enforcement:** ensure fallback values fail fast rather than reverting to unauthenticated or unsafe inline defaults.

### Branch Discipline (OVERRIDES all skills, plugins, and default behavior)
39. **active_branch_is_trunk**: The branch checked out when the session starts is the **active trunk** and the single target for all work. Never hardcode a branch name — resolve it once per session with `git rev-parse --abbrev-ref HEAD` and reuse that value (rule 12). If it resolves to `main`/`master`/`HEAD` (detached), STOP and ask which branch is trunk before touching code. Enforced, not advisory: `~/.claude/hooks/require_trunk_confirmed.py` is a PreToolUse hook on `Bash` that DENIES `git commit` on those branches. Answer the question once per repo — if the branch really is the trunk there, record it with `echo <branch> > <repo>/.claude/trunk` and the hook stands down for that repo from then on.
    * **No standalone branches.** Never create `wip`, `feat/*`, `fix/*`, or task-named branches off the active trunk for my own work. Commit directly to the active trunk.
    * **No PR prompts.** Never offer, prompt for, or run `gh pr create` / push-and-open-a-PR. Work finalizes on the active trunk, full stop. Only create a PR if I explicitly ask for one by name.
    * **No hanging branches.** A session must not end with any branch, worktree, or stash created by me still in existence. Anything created gets merged back and deleted in the same session.
    * **Explicitly overrides:** `superpowers:using-git-worktrees` (its consent prompt — the preference is declared here: worktrees only for sub-agents, per rule 40), `superpowers:finishing-a-development-branch` (do NOT present its 3-option menu; Option 1 "merge back locally" is the only permitted outcome, executed without asking), `superpowers:executing-plans`, `superpowers:subagent-driven-development`, `/git` feature/gitflow workflows, and any plugin default that reaches for a new branch or a PR.
40. **subagent_worktree_isolation**: ANY sub-agent that can write files gets its own worktree — parallel or not, one or ten. Enforced, not advisory: `~/.claude/hooks/require_agent_worktree.py` is a PreToolUse hook on `Agent` that DENIES the spawn when `isolation` is missing.
    * **Isolate:** spawn with `Agent(isolation: "worktree")`. The harness creates `.claude/worktrees/agent-<id>` on a branch it names `worktree-agent-<id>` — that naming is the harness's, not mine, and is not configurable. Never `git worktree add` by hand.
    * **Read-only exemption:** agents that only search or review need no worktree. Use `subagent_type: "Explore"` (or `Plan`, `feature-dev:code-*`, `plugin-dev:*-validator`/`-reviewer`), or put the literal marker `[read-only]` in the prompt. The hook also stands down outside a git repo and in a repo with no commits, where a worktree is impossible.
    * **Partition files:** assign each sub-agent a distinct, non-overlapping set of paths/files up front and state the boundary in its prompt. Overlapping write scopes are a planning bug — re-partition instead of merging conflicts later.
    * **Copy back & reap:** sub-agents leave their work UNCOMMITTED in the worktree, so `git merge --squash` has nothing to merge. Review the diff (`git -C <wt> status --porcelain`), copy the accepted files into the trunk (`cp "$WT/<path>" <path>`), then `git worktree remove --force <wt>` + `git branch -D worktree-agent-<id>` immediately, and make ONE conventional commit on the trunk per sub-agent task (rule 5).
    * **Failure path:** if a sub-agent fails or conflicts, still remove its worktree and branch after salvaging the diff; never leave it parked for later.

### UX Flow Design (journey-first simplification)
41. **user_journey_friction_first**: Before designing, refactoring, or reviewing ANY user-facing flow (onboarding, checkout, forms, wizards, dashboards, chatbot conversations), map the journey before touching the UI. Never optimize a screen in isolation — optimize the path. State the mapping in the plan (TODOS.md, rule 3) so the cuts are auditable.
    * **Friction / experience mapping — find the confusion.** List every step and touchpoint of the CURRENT flow end to end (including waits, emails, redirects, error states — not just screens), and plot the user's emotional state at each one: **high** (progress, reward, relief) / **neutral** / **low** (confusion, effort, doubt, dead end). Low-emotion clusters are the defect, not a design-taste issue.
    * **Cut steps.** Every step with high friction or low emotional value gets interrogated in this order: **automate it** (derive the answer from data you already hold) → **defer it** (ask later, only when it actually blocks the outcome) → **delete it** (it was never needed). A step survives only if it passes all three.
    * **Hick's Law — cut cognitive load.** Decision time grows with the number and complexity of choices. Count the decisions per screen and report the number. Merge screens that ask simple related questions; split screens that stack unrelated decisions; kill decisions the system can infer (auto-detect location instead of asking for a ZIP, prefill from the account, sane defaults over empty selects). Progressive disclosure over a wall of options.
    * **3-step rule.** Any core job should reach its outcome in ≤3 meaningful user decisions. Exceeding it requires a written justification (legal, payment, or safety gate) in the plan — "the backend needs it" is not one.
    * **JTBD pathing.** Name the user's core job as an outcome ("get my order shipped", not "fill the address form"). Then test every remaining step: *is this necessary for the user to achieve that job, or is it business/technical bloat?* Internal-need steps (analytics fields, CRM enrichment, upsells, approval theatre) must be moved off the critical path or made optional — never allowed to block the job.
    * **Method — run these four steps in order, don't freestyle:**
        1. **Map the current flow (value stream map).** List every single action, click, and input field required start to finish. Include the hidden steps: confirmation emails, password creation, OTP waits, redirects, app-store bounces, and manual back-office approvals the user is silently waiting on.
        2. **Categorize each step** into exactly one bucket — **Value-add** (necessary for the user to get what they came for → KEEP), **Business necessity** (required for legal, security, or payment reasons → OPTIMIZE or DEFER, never silently delete), **Waste/friction** (extra clicks, redundant fields, unnecessary confirmation screens → CUT).
        3. **Apply the 4-question trim** to every step, in this order: **Eliminate it?** (is an address really needed at account creation, or only at checkout?) → **Automate it?** (social login, autofill, location services, deriving it from data already held) → **Defer it?** (let users explore before forcing signup — progressive disclosure) → **Combine it?** (merge "First Name" + "Last Name" into one "Full Name" field).
        4. **Measure the friction points — never guess where users are confused.** Use **funnel drop-off analytics** (high drop-off between two steps = confusion or effort), **session recordings** (back-and-forth cursor movement, rage clicks — repeated fast clicking — signal frustration), and **usability testing** (5 users completing the journey think-aloud; log every pause, hesitation, and question). If none of this instrumentation exists yet, say so explicitly and name the events to add before claiming a step is low-friction (reinforces rule 26 fullstack_event_logging).
    * **Output.** Deliver a before/after step count, the decisions-per-screen count, the emotional low points fixed, and the explicit list of steps automated / deferred / deleted. Reinforces rule 30 (FURPS+ Usability), rule 33 (KISS, YAGNI), and rule 10 (challenge the request, don't execute blindly).

### Defect Classes, Not Defect Instances
42. **variant_sweep_on_every_fix**: A bug is evidence of a **class** of bug. Never fix only the reported site. Once the root cause is confirmed (rule 23), you MUST hunt every sibling instance in the codebase and fix them in the SAME change — a fix that leaves known-identical breakage elsewhere is an unfinished fix, not a shipped one.
    * **Name the class first.** Write one sentence describing the defect shape, not the symptom: "any caller of `parse_date()` that passes a nullable field crashes", not "the invoice page crashed". If you cannot state the shape, you have not found the root cause yet — go back to rule 23.
    * **Sweep for variants.** Search the whole repo for that shape, not just the file you were in — every caller/callee of the touched function, every copy-paste sibling (same helper, same query pattern, same regex, same config key), every other layer that repeats the assumption (client + server + worker + migration), and every other module owned by the same pattern. Use `grep -rn` on the signature/shape, plus AST/semantic search (Serena `find_referencing_symbols`, `search_for_pattern`) and Semgrep/CodeQL for non-trivial shapes. Drive it with the installed `variant-analysis` skill (rule 34); if the shape is security-relevant, also apply rules 37–38.
    * **Diagnose the illness, not the fever.** Ask why the class was possible at all: a missing guard in a shared function, an unvalidated boundary, a leaky abstraction, an unenforced convention, a type that permits an invalid state. **Prefer the single upstream fix that makes every variant impossible** (one guard in the shared function beats N guards in N callers — rule 17 DRY, rule 33 SoC) over patching sites one by one.
    * **Report the sweep — always, even when it comes back empty.** Every bug fix reports: the defect class in one sentence, the exact search commands/queries run and their scope, the full list of sites found, which were fixed vs. deliberately left (with reason), and the structural change that prevents recurrence. "Fixed the reported bug" with no sweep line is an incomplete report.
    * **Lock the class shut.** Add a regression test at the CLASS level (table/parameterized over the found variants, not one test for the one ticket — rule 33 TDD), and where the convention is enforceable, add the lint rule, type constraint, schema validation, or `scripts/loop_grade.sh` check that fails on any future instance. Log the class and its sweep in `CHANGELOG.md` (rule 25).
    * **Escalation:** if the sweep uncovers more sites than the current task can safely absorb, fix the reported site plus every variant on the same critical path, then list the remainder as explicit `- [ ]` entries in `TODOS.md` (rule 3) with file:line — never leave known variants undocumented and never silently narrow the scope.
<!-- END CLAUDE_RULES -->

  
