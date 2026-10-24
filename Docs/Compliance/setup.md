# Compliance V1 - Step-by-step bring-up

## 1) Set environment variables
Add these to `.env` (adjust as needed):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/wikid-tiptap
COMPLIANCE_DATABASE_URL=postgresql://postgres:postgres@localhost:5436/wikid-compliance

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=wikid

COMPLIANCE_S3_ENDPOINT=http://localhost:9002
COMPLIANCE_S3_REGION=us-east-1
COMPLIANCE_S3_ACCESS_KEY=minioadmin
COMPLIANCE_S3_SECRET_KEY=minioadmin
COMPLIANCE_S3_BUCKET=wikid-compliance

# Optional: upload limits
UPLOAD_MAX_BYTES=52428800
COMPLIANCE_UPLOAD_MAX_BYTES=52428800
```

## 2) Start infra
```
docker compose up -d db compliance-db minio compliance-minio minio-init compliance-minio-init
```

## 3) Generate Prisma clients
```
npm run prisma:generate
npm run prisma:generate:compliance
```

## 4) Run migrations
```
npm run prisma:migrate
npm run prisma:migrate:compliance
```

## 5) (Optional) Apply immutability guards in compliance DB
Replace `APP_ROLE` in `prisma/compliance/immutability.sql` with the app role, then run:
```
sed "s/APP_ROLE/postgres/g" prisma/compliance/immutability.sql \
  | docker compose exec -T compliance-db psql -U postgres -d wikid-compliance
```

## 6) Start the API
```
npm run start:dev
```

## 7) Sanity-check endpoints
Replace placeholders with real IDs. You can get them like this:
- `userId`: any UUID (or a real user ID from your app session)
- `workspaceId`: call `GET /pages?userId=...&userName=...` and use the `workspaceId` from returned pages (or the workspace you created in the UI)
- `databaseId`: call `GET /pages/:pageId/database` for a database page and use the returned `database.id`

Create a workflow version:
```
curl -X POST "http://localhost:3000/compliance/workflows?userId=USER_ID&userName=NAME" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"WORKSPACE_ID","databaseId":"DATABASE_ID","config":{"states":[{"id":"draft","label":"Draft"},{"id":"submitted","label":"Submitted"},{"id":"review","label":"In Review"},{"id":"closed","label":"Closed/Sealed"}],"transitions":[{"from":"draft","to":"submitted","guards":[]},{"from":"submitted","to":"review","guards":[{"type":"role","value":"reviewer"}]},{"from":"review","to":"closed","guards":[{"type":"role","value":"reviewer"},{"type":"approval"}]},{"from":"closed","to":"review","guards":[{"type":"reason"},{"type":"approval"}]}]}}'
```

Create a schema version:
```
curl -X POST "http://localhost:3000/compliance/schemas?userId=USER_ID&userName=NAME" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"WORKSPACE_ID","databaseId":"DATABASE_ID","schema":{"fields":[{"id":"field-1","name":"Title","type":"text"}]}}'
```

Submit a record:
```
curl -X POST "http://localhost:3000/compliance/records/submit?userId=USER_ID&userName=NAME" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"WORKSPACE_ID","databaseId":"DATABASE_ID","workflowVersionId":"WORKFLOW_VERSION_ID","schemaVersionId":"SCHEMA_VERSION_ID","data":{"field-1":"Example"}}'
```

## 8) Notes
- Drafts live in the workspace DB; only submissions create compliance records.
- Compliance attachments go to the separate MinIO instance.
- Export endpoint logs a read and verifies attachment hashes.
