# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Interactive UI testing (no AWS required)

From this `frontend/` directory:

```
npm install
npm run dev:mock
```

This starts a local mock backend (`local-server/`, REST on :3000 + WebSocket
on :3001) alongside Vite, implementing the same contract the real backend
does (see `../.kiro/specs/webapp-skeleton/design.md`) but backed by
in-memory fixture data instead of Cognito/S3/DynamoDB/Step Functions. Open
the printed `http://localhost:5173` URL and click through the whole flow —
upload, platform select, processing, highlights grid (Gallery/Grid, sort,
score details, multi-select, crop/confirm, compilation mode, chips/prompt),
and handoff — with no deployed infrastructure and no login.

Jobs process in a few seconds with deterministic placeholder clips (moods
drawn from `../config/moods.json`). To exercise the failure path, name an
uploaded file with "fail" in it (e.g. `clip-fail.mp4`) — that job will end
in a `failed` status partway through the pipeline.

Use plain `npm run dev` (without `:mock`) once pointed at a real deployed
backend via `VITE_REST_API_URL`/`VITE_WS_API_URL`.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
