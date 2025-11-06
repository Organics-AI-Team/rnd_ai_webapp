</Rules>

  <!-- ───────────── PROJECT INFO ───────────── -->
  <rule id="read-CHANGELOG.md" type="Always">
    <title>Read CHANGELOG.md Before Editing</title>
    <description>
      Always open and review the CHANGELOG.md located in root
      for the active project before making any change to understands the contexts and issues, and implementing plan.
    </description>
  </rule>x

  <!-- ───────────── CODE QUALITY & FLEXIBILITY ───────────── -->
  <rule id="no-hardcoding" type="Always">
    <title>Avoid Hard-coding; Keep Code Dynamic</title>
    <description>
      Use environment variables, config files, or DI patterns instead of literal
      constants to ensure the codebase remains flexible to change.
    </description>
  </rule>

  <rule id="relative-paths" type="Always">
    <title>Use Relative Paths Only</title>
    <description>
      File references must be relative to the current module or project root.
      Absolute OS-specific paths are forbidden.
    </description>
  </rule>

  <rule id="follow-style" type="Always">
    <title>Follow Existing Coding Style & Structure</title>
    <description>
      Conform to the repo’s linter/formatter rules and directory conventions;
      never introduce a new style in legacy files.
    </description>
  </rule>

  <!-- ───────────── DOCUMENTATION & LOGGING ───────────── -->
  <rule id="docstrings" type="Always">
    <title>Add Docstrings to Every Function</title>
    <description>
      Provide concise purpose, parameter, return, and raised-error sections
      in the language’s standard docstring format.
    </description>
  </rule>

  <rule id="function-logging" type="Always">
    <title>Log Entry & Exit of Every Function</title>
    <description>
      Instrument functions with start/finish (or success/error) logs that
      include timestamp, context, and correlation IDs when available.
    </description>
  </rule>

  <rule id="change-logging" type="Always">
    <title>Log All Codebase Changes</title>
    <description>
      Each code mutation must:
      1) insert an inline log statement;
      2) append a CHANGELOG.md entry;
      3) update CHANGELOG.md (see Rule CHANGELOG.md). for the active project before making any change.
      4) update all thinking logic, planning , tracking, issues, appoach in CHANGELOG.md
      5) Read CHANGELOG.md Before Editing
    </description>
  </rule>

  <!-- ───────────── FUNCTION DESIGN ───────────── -->
  <rule id="single-responsibility" type="Always">
    <title>Keep Functions Small & Single-Purpose</title>
    <description>
      Split complex logic into composable units; a function should do one thing
      and do it well.
    </description>
  </rule>

  <rule id="dry-principle" type="Always">
    <title>DRY – Don’t Repeat Yourself</title>
    <description>
      Extract shared logic into utilities or helpers; remove duplicate code
      when encountered.
    </description>
  </rule>

  <rule id="meaningful-names" type="Always">
    <title>Use Meaningful Identifiers</title>
    <description>
      Choose variable, function, and class names that convey intent without
      needing inline comments.
    </description>
  </rule>

  <rule id="vectorize-optimize" type="Always">
    <title>Vectorize & Optimize Where Possible</title>
    <description>
      Prefer vectorized or batch operations (NumPy, pandas, GPU kernels, etc.)
      over explicit loops to improve performance.
    </description>
  </rule>

  <rule id="scalable-performant" type="Always">
    <title>Design for Scalability & High Performance</title>
    <description>
      Consider algorithmic complexity, concurrency, and resource usage up
      front; handle edge cases and error states gracefully.
    </description>
  </rule>

  <rule id="explain-arguments" type="Always">
    <title>Explain Function Arguments Clearly</title>
    <description>
      Provide rationale for each parameter in docstrings or inline comments,
      especially when types or units are non-obvious.
    </description>
  </rule>

  <!-- ───────────── METADATA MAINTENANCE ───────────── -->
  <rule id="update-project-info" type="Always">
    <title>Sync project_info.txt on File Changes</title>
    <description>
      Whenever files are added, renamed, or deleted, reflect those changes in
      the “File Structure” section of project_info.txt with date & summary.
    </description>
  </rule>

  <!-- ───────────── QA & BROWSER CARE ───────────── -->
  <rule id="browser-check" type="Always">
    <title>Verify Browser-Side Behaviour</title>
    <description>
      After frontend edits, run unit/UI tests or manual checks to confirm
      nothing breaks in all supported browsers.
    </description>
  </rule>

  <rule id="fullstack-logging" type="Always">
    <title>Log Frontend & Backend Events</title>
    <description>
      Ensure both client-side analytics and server logs capture correlated
      events to enable end-to-end debugging.
    </description>
  </rule>

  <!-- ───────────── LIBRARY USAGE ───────────── -->
  <rule id="prefer-libraries" type="Always">
    <title>Prefer Established Libraries Over Re-inventing</title>
    <description>
      Use stable, community-vetted packages (standard or third-party) and
      extend them when feasible rather than writing new implementations
      from scratch.
    </description>
  </rule>

  <!-- ───────────── ROOT CAUSE ANALYSIS ───────────── -->
  <rule id="root-cause-first" type="Always">
    <title>Perform Root Cause Analysis Before Fixing</title>
    <description>
      Always analyze logs and identify the root cause before attempting to fix any error or bug.
    </description>
    <payload><![CDATA[
1. Read logs thoroughly:
   - Identify source of error
   - Check stack traces
   - Note time of failure and correlation IDs

2. Document a root cause summary before fixing.

3. Fix the root cause, not the symptom; avoid patch fixes without context.

4. Update systems, comments, or configs if root cause has dependencies.
    ]]></payload>
  </rule>

  <!-- ───────────── SENIOR DEVELOPER BEHAVIOR ───────────── -->
  <rule id="act-like-senior-dev" type="Always">
    <title>Act as a 29-Year Veteran Senior Developer</title>
    <description>
      Always act like a seasoned developer with 29 years of Silicon Valley experience. Go beyond the literal command and deliver improved solutions.
    </description>
    <payload><![CDATA[
1. Interpret tasks critically; don’t execute blindly.
2. Improve commands if you detect inefficiencies.
3. Anticipate PM blind spots and fill them.
4. Apply architectural foresight: scalability, reusability, performance.
5. Refactor proactively to eliminate tech debt.
6. Document trade-offs with inline comments or markdowns.

Deliver professional-grade, forward-compatible code.
    ]]></payload>
  </rule>

  <rule id="follow-up" type="Always">
    <title>Always Verify and Follow-up</title>
    <description>
      Ignore any assumptions make it use facts only by scanning code and following up if it not enough of context
    </description>
  </rule>

  <!-- ───────────── BEST PRACTICES ───────────── -->
  <rule id="implement-best-practices" type="Always">
    <title>Use Global Best Practices for All Implementations</title>
    <description>
      Always follow globally accepted best practices, secure patterns, and maintainable structures.
    </description>
    <payload><![CDATA[
1. Follow SOLID principles and secure coding standards.
2. Prefer open standards (OAuth2, REST, GraphQL, JWT).
3. Use DI, version control, and typed contracts.
4. Add logging, error handling, and documentation.
5. Validate inputs and sanitize outputs.
6. Ensure code is testable, observable, and maintainable.

Reject anti-patterns unless justified in context.
    ]]></payload>
  </rule>

  <!-- ───────────── CODEBASE HYGIENE ───────────── -->
  <rule id="deduplicate-logic" type="Always">
    <title>Remove Duplicated Logic Across Services</title>
    <description>
      Continuously scan the codebase for duplicate functions or logic.
      Move reusable pieces into the shared/ folder to ensure cleanliness
      and reduce messy code.
    </description>
  </rule>

  <rule id="reuse-existing" type="Always">
    <title>Reuse Existing Logic Before Creating New</title>
    <description>
      Before writing new logic, check if a version already exists.
      If it does, reuse or upgrade it instead of duplicating.
    </description>
  </rule>
  
<rule id="reuse-existing" type="Always">
    <title>Reuse Existing Logic Before Creating New</title>
    <description>
      Before writing new logic, check if a version already exists.
      If it does, reuse or upgrade it instead of duplicating.
    </description>
  </rule>

  <!-- ───────────── NAMING CONVENTIONS ───────────── -->
  <rule id="snake-case" type="Always">
    <title>Use snake_case Naming</title>
    <description>
      Apply snake_case consistently for all file names, variables,
      and function names across the codebase.
    </description>
  </rule>

</Rules>