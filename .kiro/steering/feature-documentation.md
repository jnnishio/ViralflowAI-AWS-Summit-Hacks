# Feature Documentation Guidelines

This guidance applies to ALL AI assistants working on this codebase:
- **Kiro** (via this steering file)
- **Claude Code** (via `CLAUDE.md` and `.clauderules`)
- **Cursor** (via `.cursorrules`)
- **Codex/Copilot** (via `.agents/AGENTS.md`)
- **Windsurf** (via `.windsurfrules`)

## Purpose

When developing new features for this codebase, AI assistants and agents MUST document any new dependencies, environment variables, setup steps, or configuration changes required for the feature to work.

## Documentation Requirements

After completing a feature that introduces any of the following, you MUST update the relevant documentation:

### 1. New Dependencies

When adding new packages or libraries:

- **Python**: Update `requirements.txt` or `pyproject.toml` with pinned versions
- **JavaScript/TypeScript**: Ensure `package.json` is updated (this happens automatically with npm/yarn/bun)
- **System dependencies**: Document in README.md under a "Prerequisites" or "System Requirements" section

Example documentation format:
```markdown
### New Dependency: [package-name]

- **Purpose**: [Why this dependency is needed]
- **Version**: [Exact version pinned]
- **Installation**: [Any special installation steps]
```

### 2. Environment Variables

When adding new environment variables:

- Add them to `.env.example` (create if it doesn't exist)
- Document in README.md under "Environment Variables" section
- Include: variable name, purpose, example value, whether it's required/optional

Example format:
```markdown
| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| NEW_VAR  | Yes      | Description | `value` |
```

### 3. AWS Resources / Infrastructure

When adding new AWS services or resources:

- Update the architecture diagram in README.md or `ARCHITECTURE_NOTES.md`
- Document required IAM permissions
- Note any CDK/SAM/CloudFormation changes needed
- Add cost estimates if significant

### 4. Configuration Files

When adding new config files or modifying existing ones:

- Document the config file's purpose and location
- Provide example configurations
- Note any required vs optional fields

### 5. Setup Steps

When a feature requires manual setup:

- Add numbered steps to a "Getting Started" or "Setup" section
- Include any database migrations, seed data, or initialization commands
- Note platform-specific instructions (macOS, Linux, Windows)

## Where to Document

1. **README.md** - High-level setup, quick start, prerequisites
2. **docs/SETUP.md** - Detailed setup instructions (create if complex)
3. **CHANGELOG.md** - Brief note about what was added (create if doesn't exist)
4. **Inline code comments** - For non-obvious configuration or integration points

## Documentation Template

When completing a feature, provide a summary like:

```markdown
## Feature: [Feature Name]

### Dependencies Added
- [List any new packages with versions]

### Environment Variables
- [List any new env vars needed]

### Setup Steps
1. [Any additional steps needed]

### Configuration Changes
- [Any config files modified or created]

### Infrastructure/AWS Changes
- [Any new services or resources required]
```

## Enforcement

This steering file ensures that every feature developed by AI assistants includes proper documentation for reproducibility. Before marking a feature complete, verify:

- [ ] All new dependencies are documented with versions
- [ ] All new environment variables are in `.env.example` and documented
- [ ] Any infrastructure changes are noted
- [ ] Setup steps are clear enough for a new developer to follow
